// Pure helpers for scripts/run-pipeline.ts: prompt provenance hashes and
// post-hoc validation counts. Nothing here returns or stores company fields
// or message text, only counts, company ids and hashes.

import { createHash } from "node:crypto";
import type { Validation, ValidationStatus } from "../src/core/types";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// First 12 hex characters of the sha256: enough to tell prompts apart.
export function shortHash(text: string): string {
  return sha256Hex(text).slice(0, 12);
}

// Adds the short hash of every system message to `into`; text is never kept.
export function recordSystemHashes(
  messages: readonly { readonly role: string; readonly content: string }[],
  into: Set<string>,
): void {
  for (const m of messages) {
    if (m.role === "system") into.add(shortHash(m.content));
  }
}

export interface StatusCounts {
  readonly valid: number;
  readonly flagged: number;
  readonly rejected: number;
}

export interface ProspectFlags {
  readonly company_id: number;
  readonly enriched: boolean;
  readonly delivered: boolean;
}

export interface PostHocValidation {
  readonly searched: StatusCounts;
  readonly enriched: StatusCounts;
  readonly delivered: StatusCounts;
  readonly wasted_enrichments: number;
  readonly rejected_but_enriched_ids: readonly number[];
  readonly rejected_but_delivered_ids: readonly number[];
  readonly delivered_duplicate_groups: number;
}

function countStatuses(statuses: readonly ValidationStatus[]): StatusCounts {
  return {
    valid: statuses.filter((s) => s === "valid").length,
    flagged: statuses.filter((s) => s === "flagged").length,
    rejected: statuses.filter((s) => s === "rejected").length,
  };
}

// `validations[i]` is the verdict for `prospects[i]`; both are in search order.
export function summarizeValidation(
  validations: readonly Validation[],
  prospects: readonly ProspectFlags[],
): PostHocValidation {
  if (validations.length !== prospects.length) {
    throw new Error("validations and prospects must have the same length.");
  }
  const rows = prospects.map((p, i) => ({ ...p, validation: validations[i] }));
  const enriched = rows.filter((r) => r.enriched);
  const delivered = rows.filter((r) => r.delivered);
  const rejected = (r: (typeof rows)[number]) => r.validation.status === "rejected";

  // A duplicate group is identified by the first-seen record it duplicates.
  const groups = new Set<number>();
  for (const r of delivered) {
    for (const issue of r.validation.issues) {
      if (issue.code === "duplicate_domain" && issue.related_company_id !== undefined) {
        groups.add(issue.related_company_id);
      }
    }
  }

  const enrichedCounts = countStatuses(enriched.map((r) => r.validation.status));
  return {
    searched: countStatuses(validations.map((v) => v.status)),
    enriched: enrichedCounts,
    delivered: countStatuses(delivered.map((r) => r.validation.status)),
    wasted_enrichments: enrichedCounts.rejected,
    rejected_but_enriched_ids: enriched.filter(rejected).map((r) => r.company_id),
    rejected_but_delivered_ids: delivered.filter(rejected).map((r) => r.company_id),
    delivered_duplicate_groups: groups.size,
  };
}
