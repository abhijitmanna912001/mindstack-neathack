// Agent-local types for the naive baseline pipeline. These are not part of
// the shared contract in src/core/types.ts; they cover what the baseline has
// and nothing more (no validation, no facts).

import type {
  BudgetSnapshot,
  CompanyProvider,
  ProviderErrorCategory,
  SearchFilters,
} from "../data/provider";
import type { Assessment, RawCompany, Run, RunConfig, RunStep } from "../types";
import type { LlmCallMeta, LlmClient, LlmErrorCategory } from "./llm";
import type { LlmCostBasis, LlmKeySpend } from "./llm-cost";
import type { PipelineTracer } from "./tracer";

// What the user asked for. Built by the app from its form.
export interface IcpInput {
  // Free text; mapped to provider industry labels via autocomplete.
  readonly industry: string;
  // Provider range strings, e.g. "51-200". Empty means any size.
  readonly employee_count_ranges: readonly string[];
  // Countries. SearchFilters takes one, so only the first is searched.
  readonly locations: readonly string[];
  // Given to the model only; the provider has no keyword filter.
  readonly keywords: readonly string[];
  // Given to the model only; the baseline does not filter on them.
  readonly excluded_domains: readonly string[];
}

export type EnrichmentStatus =
  | "enriched" // returned by the enrich call
  | "not_returned" // requested, but missing from the response
  | "skipped_budget" // not requested, or refused, because of the enrichment cap
  | "skipped_no_linkedin" // no LinkedIn URL, so it cannot be enriched
  | "failed"; // the enrich call failed

export interface EnrichmentOutcome {
  readonly status: EnrichmentStatus;
  // Set when the enrich call returned an error.
  readonly error_category?: ProviderErrorCategory;
}

export type AssessmentOutcome =
  | { readonly status: "assessed"; readonly assessment: Assessment }
  | {
      readonly status: "failed";
      readonly reason: "llm_error" | "malformed_output" | "truncated";
      readonly message: string;
      // Set when reason is "llm_error".
      readonly error_category?: LlmErrorCategory;
    }
  | {
      readonly status: "not_assessed";
      // llm_stopped: an earlier call failed in a way every later call would
      // repeat (auth failure, or rate limiting after all retries).
      readonly reason: "llm_call_cap" | "not_enriched" | "llm_stopped";
    };

// The model call made for one company. The same object feeds the result and
// the assess_company span, so the two always agree.
export interface LlmCallRecord extends LlmCallMeta {
  // 1-based position among this run's logical model calls.
  readonly call_number: number;
}

// One company in the baseline result. Deliberately not the shared Prospect:
// the baseline has no validation or facts, and faking them would hide that.
export interface BaselineProspect {
  // The enriched record when enrichment returned it, else the search record.
  readonly raw: RawCompany;
  readonly enrichment: EnrichmentOutcome;
  readonly assessment: AssessmentOutcome;
  // Absent when no model call was made for this company.
  readonly llm_call?: LlmCallRecord;
}

// Model cost for the run, split by how each figure is known.
export interface LlmCostSummary {
  readonly gateway_reported_usd: number;
  readonly estimated_usd: number;
  // gateway_reported_usd + estimated_usd.
  readonly known_usd: number;
  readonly calls_by_basis: Readonly<Record<LlmCostBasis, number>>;
  // False when any call's cost is unavailable; known_usd is then a lower
  // bound, not the run's cost.
  readonly complete: boolean;
  // From the most recent response that carried LiteLLM key-spend headers.
  readonly latest_key_spend?: LlmKeySpend;
}

export type PipelineIssueCode =
  | "industry_not_recognised"
  | "industry_autocomplete_failed"
  | "extra_locations_ignored"
  | "search_budget_exhausted"
  | "search_no_match"
  | "search_failed"
  | "enrich_budget_exhausted"
  | "enrich_no_results"
  | "enrich_partial"
  | "enrich_failed"
  | "llm_call_cap_reached"
  | "llm_stopped"
  | "llm_cost_incomplete";

// A run-level note or failure. Per-company problems live on the prospect.
export interface PipelineIssue {
  readonly step: RunStep;
  readonly code: PipelineIssueCode;
  readonly message: string;
  // Provider failures.
  readonly error_category?: ProviderErrorCategory;
  // Model failures.
  readonly llm_error_category?: LlmErrorCategory;
}

// completed_empty: the search found nothing. stopped: search failed, so the
// run could not continue.
export type PipelineStatus = "completed" | "completed_empty" | "stopped";

export interface PipelineResult {
  readonly status: PipelineStatus;
  readonly run: Run;
  readonly filters: SearchFilters;
  readonly prospects: readonly BaselineProspect[];
  readonly issues: readonly PipelineIssue[];
  readonly usage: {
    readonly provider: BudgetSnapshot;
    readonly max_search_results: number;
    readonly max_enrichments: number;
    // Logical model calls; this is what max_llm_calls_per_run caps.
    readonly llm_calls: number;
    readonly max_llm_calls_per_run: number;
    // HTTP requests behind those calls, retries included.
    readonly llm_http_attempts: number;
    readonly llm_cost: LlmCostSummary;
  };
}

export interface PipelineDeps {
  readonly provider: CompanyProvider;
  // The BudgetGuard the provider enforces, read to size enrich requests.
  // CompanyProvider does not expose one, so it is passed separately (for a
  // FixtureProvider, pass provider.budget).
  readonly budget: { snapshot(): BudgetSnapshot };
  readonly llm: LlmClient;
  readonly tracer?: PipelineTracer;
  // Defaults to a random UUID.
  readonly trace_id?: string;
  // Milliseconds clock for step timings. Defaults to Date.now.
  readonly now?: () => number;
}

export interface PipelineOptions {
  // Defaults to DEV_RUN_CONFIG.
  readonly config?: RunConfig;
  // Which companies go to the model. Defaults to every searched company, so
  // the baseline trace shows what happens with unenriched and junk records.
  readonly assess?: "all_searched" | "enriched_only";
}
