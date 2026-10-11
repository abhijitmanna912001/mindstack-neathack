// Agent-local types for the baseline and improved pipelines. These are not
// part of the shared contract in src/core/types.ts. Both pipelines return
// the same PipelineResult; fields only the improved pipeline fills are
// optional, so the baseline result is unchanged.

import type {
  BudgetSnapshot,
  CompanyProvider,
  ProviderErrorCategory,
  SearchFilters,
} from "../data/provider";
import type {
  AnyFact,
  Assessment,
  RawCompany,
  Run,
  RunConfig,
  RunStep,
  Validation,
} from "../types";
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
  // Given to the model only; neither pipeline filters on them.
  readonly excluded_domains: readonly string[];
}

// Which pipeline produced a result.
export type PipelineKind = "naive_baseline" | "improved";

export type EnrichmentStatus =
  | "enriched" // returned by the enrich call
  | "not_returned" // requested, but missing from the response
  | "skipped_budget" // not requested, or refused, because of the enrichment cap
  | "skipped_no_linkedin" // no LinkedIn URL, so it cannot be enriched
  | "skipped_ineligible" // improved only: rejected by validation (incl. duplicates)
  | "failed"; // the enrich call failed

export interface EnrichmentOutcome {
  readonly status: EnrichmentStatus;
  // Set when the enrich call returned an error.
  readonly error_category?: ProviderErrorCategory;
}

export type CheckSeverity = "error" | "warning";

export type CheckFindingCode =
  // validateAssessment
  | "fit_score_out_of_range"
  | "criterion_score_out_of_range"
  | "missing_criterion"
  | "unexpected_criterion"
  | "duplicate_criterion"
  | "unknown_fact_reference"
  | "uncertain_fact_reference"
  // checkClaims
  | "no_citations"
  | "duplicate_citation"
  | "unknown_citation"
  | "model_fact_citation"
  | "non_citeable_citation"
  | "unsupported_number";

// One problem found by validateAssessment() or checkClaims(). Errors make the
// assessment (or outreach) unusable; warnings are recorded only.
export interface CheckFinding {
  readonly code: CheckFindingCode;
  readonly severity: CheckSeverity;
  readonly message: string;
  readonly fact_id?: string;
  readonly criterion?: string;
}

export interface CheckResult {
  // True when there are no error findings.
  readonly ok: boolean;
  readonly findings: readonly CheckFinding[];
}

// What the improved pipeline's guardrails decided for one company.
export interface AssessmentChecks {
  readonly assessment: CheckResult;
  // Absent when the assessment failed validation or drafted no outreach.
  readonly claims?: CheckResult;
  // kept: outreach passed checkClaims. removed: it failed and was dropped
  // from the assessment. none: there was no usable outreach to check.
  readonly outreach: "kept" | "removed" | "none";
}

export type AssessmentOutcome =
  | { readonly status: "assessed"; readonly assessment: Assessment }
  | {
      readonly status: "failed";
      // invalid_assessment: improved only; validateAssessment() found errors.
      readonly reason: "llm_error" | "malformed_output" | "truncated" | "invalid_assessment";
      readonly message: string;
      // Set when reason is "llm_error".
      readonly error_category?: LlmErrorCategory;
    }
  | {
      readonly status: "not_assessed";
      // llm_stopped: an earlier call failed in a way every later call would
      // repeat (auth failure, or rate limiting after all retries).
      // rejected / duplicate: improved only; validation rejected the record
      // (duplicate when the reason was a duplicate_domain issue).
      readonly reason:
        | "llm_call_cap"
        | "not_enriched"
        | "llm_stopped"
        | "rejected"
        | "duplicate";
    };

// The model call made for one company. The same object feeds the result and
// the assess_company span, so the two always agree.
export interface LlmCallRecord extends LlmCallMeta {
  // 1-based position among this run's logical model calls.
  readonly call_number: number;
}

// One company in a pipeline result. The baseline fills only the first four
// fields; the improved pipeline also records validation, facts and checks.
// Deliberately not the shared Prospect, whose validation and facts are
// required: the baseline has neither, and faking them would hide that.
export interface BaselineProspect {
  // The enriched record when enrichment returned it, else the search record.
  readonly raw: RawCompany;
  readonly enrichment: EnrichmentOutcome;
  readonly assessment: AssessmentOutcome;
  // Absent when no model call was made for this company.
  readonly llm_call?: LlmCallRecord;
  // Improved only: the verdict on the search record.
  readonly search_validation?: Validation;
  // Improved only: the verdict on `raw` (re-run after enrichment).
  readonly validation?: Validation;
  // Improved only: buildFacts(raw, validation); empty when rejected.
  readonly facts?: readonly AnyFact[];
  // Improved only: present when a model assessment was checked.
  readonly checks?: AssessmentChecks;
}

// Same type, named for code that handles either pipeline.
export type PipelineProspect = BaselineProspect;

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

// A count with the company ids behind it. Ids only, never records.
export interface IdCount {
  readonly count: number;
  readonly company_ids: readonly number[];
}

// Guardrail outcomes of an improved run, as counts and company ids only.
// Plain JSON: no records, no Maps or Sets.
export interface ImprovedRunMetrics {
  // Rejected by validation for a reason other than being a duplicate.
  readonly rejected: IdCount;
  // Usable but suspicious (status "flagged" in the final validation).
  readonly flagged: IdCount;
  // Later duplicates removed (duplicate_domain), at search or after enrichment.
  readonly duplicates_removed: IdCount;
  readonly enrichment: {
    // Not rejected at search and has a LinkedIn URL. Ids in search order.
    readonly eligible: IdCount;
    // Sent to the enrich call, within the cap. Ids in the order sent:
    // "valid" companies first, then "flagged", each in search order.
    readonly requested: IdCount;
    // Returned by the enrich call. Ids in search order.
    readonly enriched: IdCount;
  };
  readonly assessments_failed: IdCount & {
    readonly by_reason: Readonly<Record<string, number>>;
  };
  // Outreach drafted by the model but removed because it failed checkClaims.
  readonly outreach_suppressed: IdCount;
  readonly claim_violations: {
    // Error findings from checkClaims across all drafts.
    readonly count: number;
    // Drafts with at least one violation.
    readonly drafts: number;
    readonly by_code: Readonly<Record<string, number>>;
    readonly company_ids: readonly number[];
  };
}

// Citation quality of a baseline run's outreach, measured after the fact
// with the improved pipeline's validation and facts. Counts and ids only.
export interface BaselineCitationMetrics {
  readonly fact_provider: FactProvenance;
  readonly prospects: number;
  readonly assessed: number;
  readonly outreach_drafts: number;
  // Distinct fact ids cited across all drafts (counted once per draft).
  readonly cited_fact_ids: number;
  // Each cited id falls into exactly one of these, in this order of checks:
  // missing (no such fact for that company), model_provider, uncertain,
  // other_non_citeable (any other status outside CITEABLE_FACT_STATUSES),
  // citeable.
  readonly citeable: number;
  readonly missing: number;
  // The part of `missing` that names another company's fact.
  readonly cross_company: number;
  readonly model_provider: number;
  readonly uncertain: number;
  readonly other_non_citeable: number;
  // Drafts citing at least one id that is not citeable.
  readonly drafts_with_violations: IdCount;
}

export interface PipelineResult {
  readonly pipeline: PipelineKind;
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
    // Attempts behind those calls, retries included, as reported by the
    // LLM client (real HTTP requests for the gateway client).
    readonly llm_http_attempts: number;
    readonly llm_cost: LlmCostSummary;
  };
  // Improved only: guardrail outcomes as counts and ids. Absent for the
  // baseline and for improved runs that stopped before validation.
  readonly metrics?: ImprovedRunMetrics;
}

// Where company data came from, for buildFacts() provenance: "fixture" for
// FixtureProvider data, "crustdata" for real Crustdata data.
export type FactProvenance = "crustdata" | "fixture";

// Dependencies for runBaselinePipeline (and the base for the improved
// pipeline's). fact_provider is optional here so existing baseline callers
// need not set it; the baseline never reads it.
export interface PipelineDeps {
  readonly provider: CompanyProvider;
  // The BudgetGuard the provider enforces, read to size enrich requests.
  // CompanyProvider does not expose one, so it is passed separately (for a
  // FixtureProvider, pass provider.budget).
  readonly budget: { snapshot(): BudgetSnapshot };
  readonly llm: LlmClient;
  // Ignored by the baseline. Allowed so one deps object can drive both
  // pipelines.
  readonly fact_provider?: FactProvenance;
  readonly tracer?: PipelineTracer;
  // Defaults to a random UUID.
  readonly trace_id?: string;
  // Milliseconds clock for step timings. Defaults to Date.now.
  readonly now?: () => number;
}

// Dependencies for runImprovedPipeline: the same, but fact provenance must be
// stated explicitly. The pipeline never guesses or defaults it.
export interface ImprovedPipelineDeps extends PipelineDeps {
  readonly fact_provider: FactProvenance;
}

export interface PipelineOptions {
  // Defaults to DEV_RUN_CONFIG.
  readonly config?: RunConfig;
  // Baseline only: which companies go to the model. Defaults to every
  // searched company. The improved pipeline always assesses only enriched,
  // non-rejected companies and ignores this option.
  readonly assess?: "all_searched" | "enriched_only";
}
