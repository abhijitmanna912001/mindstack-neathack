// Pure helpers for scripts/run-pipeline.ts: flag parsing and validation,
// prompt provenance hashes and post-hoc validation counts. Nothing here
// returns or stores company fields or message text, only counts, company ids
// and hashes. Environment values are only tested for presence, never returned.

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

// --- Flags -------------------------------------------------------------------

export class UsageError extends Error {}

export const EXIT_OK = 0;
// The run failed, or stopped early (a search failure, for example).
export const EXIT_FAILED = 1;
// Bad flags or a refused combination; nothing was run.
export const EXIT_USAGE = 2;

export function exitCodeForError(err: unknown): number {
  return err instanceof UsageError ? EXIT_USAGE : EXIT_FAILED;
}

export function exitCodeForStatus(status: "completed" | "completed_empty" | "stopped"): number {
  return status === "stopped" ? EXIT_FAILED : EXIT_OK;
}

export interface RunArgs {
  readonly pipeline: "baseline" | "improved";
  readonly llm: "fake" | "real";
  readonly provider: "fixture" | "crustdata";
  readonly confirm_spend: boolean;
  // Explicit --trace on|off; undefined when the flag is absent.
  readonly trace: "on" | "off" | undefined;
  readonly label: string;
  readonly config: "dev" | "eval";
  // Crustdata ICP; undefined unless given. Refused with --provider fixture.
  readonly industry: string | undefined;
  readonly country: string | undefined;
  readonly sizes: readonly string[] | undefined;
}

export const DEFAULT_CRUSTDATA_ICP = {
  industry: "Staffing and Recruiting",
  country: "India",
  sizes: ["11-50", "51-200"],
} as const;

const SIZE_RANGE = /^(\d+-\d+|\d+\+)$/;

export function parseRunArgs(argv: readonly string[]): RunArgs {
  let pipeline: string | undefined;
  let llm = "fake";
  let provider = "fixture";
  let confirm_spend = false;
  let trace: string | undefined;
  let label: string | undefined;
  let config = "eval";
  let industry: string | undefined;
  let country: string | undefined;
  let sizes: string | undefined;
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--pipeline":
        pipeline = value(i++, flag);
        break;
      case "--llm":
        llm = value(i++, flag);
        break;
      case "--provider":
        provider = value(i++, flag);
        break;
      case "--trace":
        trace = value(i++, flag);
        break;
      case "--label":
        label = value(i++, flag);
        break;
      case "--config":
        config = value(i++, flag);
        break;
      case "--industry":
        industry = value(i++, flag);
        break;
      case "--country":
        country = value(i++, flag);
        break;
      case "--sizes":
        sizes = value(i++, flag);
        break;
      case "--confirm-spend":
        confirm_spend = true;
        break;
      default:
        throw new UsageError(`Unknown argument: ${flag}`);
    }
  }
  if (pipeline === undefined) throw new UsageError("--pipeline is required (baseline or improved).");
  if (pipeline !== "baseline" && pipeline !== "improved") {
    throw new UsageError(`--pipeline must be baseline or improved, got "${pipeline}".`);
  }
  if (llm !== "fake" && llm !== "real") throw new UsageError(`--llm must be fake or real, got "${llm}".`);
  if (provider !== "fixture" && provider !== "crustdata") {
    throw new UsageError(`--provider must be fixture or crustdata, got "${provider}".`);
  }
  if (trace !== undefined && trace !== "on" && trace !== "off") {
    throw new UsageError(`--trace must be on or off, got "${trace}".`);
  }
  if (config !== "dev" && config !== "eval") {
    throw new UsageError(`--config must be dev or eval, got "${config}".`);
  }
  const finalLabel = label ?? pipeline;
  if (finalLabel.trim() === "") throw new UsageError("--label must not be empty.");
  if (industry !== undefined && industry.trim() === "") throw new UsageError("--industry must not be empty.");
  if (country !== undefined && country.trim() === "") throw new UsageError("--country must not be empty.");
  let sizeList: string[] | undefined;
  if (sizes !== undefined) {
    sizeList = sizes.split(",").map((s) => s.trim());
    const bad = sizeList.find((s) => !SIZE_RANGE.test(s));
    if (bad !== undefined) {
      throw new UsageError(`--sizes must be comma-separated ranges like 11-50 or 10001+, got "${bad}".`);
    }
  }
  return {
    pipeline,
    llm,
    provider,
    confirm_spend,
    trace,
    label: finalLabel,
    config,
    industry: industry?.trim(),
    country: country?.trim(),
    sizes: sizeList,
  };
}

export interface ResolvedRun extends RunArgs {
  readonly tracing: boolean;
  readonly industry: string | undefined;
  readonly country: string | undefined;
  readonly sizes: readonly string[] | undefined;
}

// Refuses unsafe or incomplete combinations before anything is built or any
// network call is made. `env` is only checked for presence; values are never
// read into a message.
export function validateRunArgs(
  args: RunArgs,
  env: Readonly<Record<string, string | undefined>>,
): ResolvedRun {
  const present = (name: string) => (env[name] ?? "").trim() !== "";
  if (args.provider === "crustdata") {
    if (args.trace === "on") {
      throw new UsageError(
        "--trace on cannot be used with --provider crustdata: traces would expose real company data. Tracing is always off for crustdata runs.",
      );
    }
    if (!args.confirm_spend) {
      throw new UsageError("--provider crustdata spends money on Crustdata. Add --confirm-spend to proceed.");
    }
    if (!present("CRUSTDATA_API_KEY")) {
      throw new UsageError("CRUSTDATA_API_KEY is not set; it is required for --provider crustdata.");
    }
  } else if (args.industry !== undefined || args.country !== undefined || args.sizes !== undefined) {
    throw new UsageError("--industry, --country and --sizes apply only to --provider crustdata.");
  }
  if (args.llm === "real") {
    if (!args.confirm_spend) {
      throw new UsageError("--llm real spends money on the model gateway. Add --confirm-spend to proceed.");
    }
    if (!present("LITELLM_API_KEY")) {
      throw new UsageError("LITELLM_API_KEY is not set; it is required for --llm real.");
    }
  }
  return {
    ...args,
    tracing: args.provider === "fixture" && args.trace !== "off",
    industry: args.provider === "crustdata" ? (args.industry ?? DEFAULT_CRUSTDATA_ICP.industry) : undefined,
    country: args.provider === "crustdata" ? (args.country ?? DEFAULT_CRUSTDATA_ICP.country) : undefined,
    sizes: args.provider === "crustdata" ? (args.sizes ?? DEFAULT_CRUSTDATA_ICP.sizes) : undefined,
  };
}

// The ICP for a run: open for fixture runs, from the flags for crustdata.
export function buildRunIcp(run: ResolvedRun): {
  readonly industry: string;
  readonly employee_count_ranges: readonly string[];
  readonly locations: readonly string[];
  readonly keywords: readonly string[];
  readonly excluded_domains: readonly string[];
} {
  const crustdata = run.provider === "crustdata";
  return {
    industry: crustdata ? (run.industry ?? "") : "",
    employee_count_ranges: crustdata ? (run.sizes ?? []) : [],
    locations: crustdata && run.country !== undefined ? [run.country] : [],
    keywords: [],
    excluded_domains: [],
  };
}
