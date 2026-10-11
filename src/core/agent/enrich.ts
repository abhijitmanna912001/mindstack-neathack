// Enriches searched companies in search order, within the enrichment cap.
// Naive on purpose: no ranking, no duplicate checks, one batch call.

import { normalizeLinkedInUrl } from "../data/normalize";
import type { CompanyProvider } from "../data/provider";
import type { RawCompany } from "../types";
import type { EnrichmentOutcome, PipelineIssue } from "./types";

export interface EnrichStepResult {
  // Index-aligned with the searched companies.
  readonly outcomes: readonly EnrichmentOutcome[];
  // Searched-company index -> the enriched record for it.
  readonly enriched: ReadonlyMap<number, RawCompany>;
  readonly issues: readonly PipelineIssue[];
  readonly requested: number;
  // Indices (into `companies`) of the companies sent to the enrich call.
  readonly requested_indices: readonly number[];
  readonly cost_usd: number;
  readonly calls: number;
}

export async function enrichInSearchOrder(
  companies: readonly RawCompany[],
  provider: CompanyProvider,
  remaining_enrichments: number,
): Promise<EnrichStepResult> {
  const outcomes: EnrichmentOutcome[] = companies.map((c) => ({
    status:
      c.professional_network_url.trim() === "" ? "skipped_no_linkedin" : "skipped_budget",
  }));
  const enriched = new Map<number, RawCompany>();
  const issues: PipelineIssue[] = [];

  const candidates = companies
    .map((c, i) => i)
    .filter((i) => outcomes[i].status !== "skipped_no_linkedin");
  // BudgetGuard refuses a whole call that asks for more than the cap allows,
  // so ask only for what is left.
  const selected = candidates.slice(0, Math.max(0, remaining_enrichments));

  if (selected.length === 0) {
    if (candidates.length > 0) {
      issues.push({
        step: "enrich",
        code: "enrich_budget_exhausted",
        message: "No enrichments left in this run's budget.",
      });
    }
    return { outcomes, enriched, issues, requested: 0, requested_indices: [], cost_usd: 0, calls: 0 };
  }

  const result = await provider.enrichCompanies(
    selected.map((i) => companies[i].professional_network_url),
  );

  if (!result.ok) {
    const category = result.error.category;
    const status =
      category === "budget_cap_reached"
        ? "skipped_budget"
        : category === "no_match"
          ? "not_returned"
          : "failed";
    for (const i of selected) outcomes[i] = { status, error_category: category };
    issues.push({
      step: "enrich",
      code:
        category === "budget_cap_reached"
          ? "enrich_budget_exhausted"
          : category === "no_match"
            ? "enrich_no_results"
            : "enrich_failed",
      message: `Enrichment of ${selected.length} companies returned ${category}: ${result.error.message}`,
      error_category: category,
    });
    return { outcomes, enriched, issues, requested: selected.length, requested_indices: selected, cost_usd: 0, calls: 0 };
  }

  // Match each request to a returned record by id, then by LinkedIn URL.
  const byId = new Map(result.data.map((r) => [r.crustdata_company_id, r]));
  const byUrl = new Map(
    result.data
      .filter((r) => r.professional_network_url !== "")
      .map((r) => [normalizeLinkedInUrl(r.professional_network_url), r]),
  );
  let missing = 0;
  for (const i of selected) {
    const company = companies[i];
    const match =
      byId.get(company.crustdata_company_id) ??
      byUrl.get(normalizeLinkedInUrl(company.professional_network_url));
    if (match) {
      outcomes[i] = { status: "enriched" };
      enriched.set(i, match);
    } else {
      outcomes[i] = { status: "not_returned" };
      missing += 1;
    }
  }
  if (missing > 0) {
    issues.push({
      step: "enrich",
      code: "enrich_partial",
      message: `${missing} of ${selected.length} requested companies were not returned by enrichment.`,
    });
  }

  return {
    outcomes,
    enriched,
    issues,
    requested: selected.length,
    requested_indices: selected,
    cost_usd: result.cost_usd,
    calls: result.calls,
  };
}
