// SignalScout core types. Plain TypeScript only: no Next.js imports.
// Data flows through four layers: Raw -> Validation -> Assessment -> Run.

// ---------------------------------------------------------------------------
// Layer 1: RawCompany (what Crustdata returned, never edited)
// ---------------------------------------------------------------------------

// Which Crustdata endpoint produced the data: "search" is the cheap list
// lookup, "enrich" is the paid, detailed lookup for one company.
export type SourceEndpoint = "search" | "enrich";

// Fields every search result carries. Any text field may be an empty string
// when Crustdata has no value for it.
export interface RawSearchFields {
  // Crustdata's own numeric ID for the company. Our unique key.
  readonly crustdata_company_id: number;
  // Company name as Crustdata reports it.
  readonly name: string;
  // Main web domain, e.g. "acme.com". Different companies can share one.
  readonly primary_domain: string;
  // Company website URL as listed.
  readonly website: string;
  // The company's LinkedIn page URL.
  readonly professional_network_url: string;
  // Headcount bucket as text, e.g. "51-200".
  readonly employee_count_range: string;
  // Industry label as Crustdata reports it.
  readonly industry: string;
  // URL of the company logo image.
  readonly logo: string;
}

// City / state / country of the company. Each part may be missing.
export interface RawLocation {
  // City name.
  readonly city?: string;
  // State or region.
  readonly state?: string;
  // Country name.
  readonly country?: string;
}

// Extra fields only the enrich endpoint returns. All are optional because
// enrichment can come back partial.
export interface RawEnrichmentFields {
  // Free-text company description.
  readonly description?: string;
  // Year the company was founded.
  readonly founded_year?: number;
  // Legal structure, e.g. "Privately Held".
  readonly legal_type?: string;
  // Most recent total employee count.
  readonly latest_headcount?: number;
  // Revenue bucket as text, e.g. "$10M-$50M".
  readonly revenue_range?: string;
  // Where the company is based.
  readonly location?: RawLocation;
  // Topics / skills the company lists about itself.
  readonly specialities?: readonly string[];
  // Number of LinkedIn followers.
  readonly linkedin_followers?: number;
}

// A company exactly as Crustdata gave it, plus bookkeeping about the call.
// Enrichment fields are absent for companies that were only searched.
export interface RawCompany extends RawSearchFields, RawEnrichmentFields {
  // Which endpoint this data came from.
  readonly source: SourceEndpoint;
  // When we received it, as an ISO 8601 timestamp.
  readonly retrieved_at: string;
  // What this one call cost in US dollars.
  readonly cost_usd: number;
}

// ---------------------------------------------------------------------------
// Layer 2: Validation (decided by code rules, never by the model)
// ---------------------------------------------------------------------------

// Overall verdict: "valid" = good to use, "flagged" = usable but suspicious,
// "rejected" = dropped from results.
export type ValidationStatus = "valid" | "flagged" | "rejected";

// Machine-readable name of each rule that can fail.
export type ValidationIssueCode =
  | "missing_name" // no company name
  | "missing_domain" // no primary domain
  | "junk_website" // website is a placeholder or not a real site
  | "duplicate_domain" // another company in this run has the same domain (or LinkedIn URL)
  | "size_headcount_mismatch" // size bucket and headcount disagree
  | "missing_linkedin"; // no LinkedIn page

// One problem found by a validation rule.
export interface ValidationIssue {
  // Which rule failed.
  readonly code: ValidationIssueCode;
  // The raw field the rule looked at, e.g. "primary_domain".
  readonly field: string;
  // Plain-English explanation of the problem.
  readonly reason: string;
  // For duplicate issues: the crustdata_company_id of the other record this
  // one appears to duplicate. Unused for other issue codes.
  readonly related_company_id?: number;
}

// Result of running all code rules on one company.
export interface Validation {
  // The overall verdict.
  readonly status: ValidationStatus;
  // Every problem found. Empty when the company is clean.
  readonly issues: readonly ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Layer 3: Facts and Assessment (model-written judgement, grounded in facts)
// ---------------------------------------------------------------------------

// How much we trust a fact. Only deterministic code ever sets this; the model
// may only reference existing fact ids and never assigns or changes a status.
// "given" = reported directly by a provider or the user, unchanged.
// "extracted" = pulled out of free text; not citeable until verified.
// "cross_checked" = at least two independent facts agree, and those facts are
//   listed in derived_from.
// "uncertain" = conflicting or unsupported; never citeable.
export type FactStatus = "given" | "extracted" | "cross_checked" | "uncertain";

// Who produced a fact. Facts with provider "model" are never citeable.
export type FactProvider =
  | "crustdata"
  | "fixture"
  | "user_input"
  | "derived"
  | "model";

// Where a fact came from.
export interface FactSource {
  // The system that produced the fact.
  readonly provider: FactProvider;
  // Which Crustdata operation returned it, when the provider is crustdata.
  readonly operation?: "autocomplete" | "company_search" | "company_enrich";
  // The provider's own ID for the record the fact came from.
  readonly record_id?: string;
  // When we received it, as an ISO 8601 timestamp.
  readonly retrieved_at: string;
  // Public URL backing the fact, if any.
  readonly source_url?: string;
}

// One factual claim with its value, origin and trust level.
export interface Fact<T> {
  // Unique ID that scores and outreach drafts reference.
  readonly id: string;
  // The machine-readable value, e.g. 120.
  readonly value: T;
  // The claim in plain English, e.g. "Has about 120 employees".
  readonly claim: string;
  // The raw field this fact rests on, e.g. "latest_headcount".
  readonly field?: string;
  // Where the fact came from.
  readonly source: FactSource;
  // How trustworthy the fact is. Set by deterministic code only.
  readonly status: FactStatus;
  // When the fact was true, as an ISO 8601 timestamp, if known.
  readonly as_of?: string;
  // For "cross_checked" facts: IDs of the facts that agree.
  readonly derived_from?: readonly string[];
}

// A fact of any value type.
export type AnyFact = Fact<unknown>;

// Only facts with one of these statuses may be cited in outreach.
export const CITEABLE_FACT_STATUSES: readonly FactStatus[] = [
  "given",
  "cross_checked",
];

// A score for one criterion from the user's request (e.g. "right size").
export interface CriterionScore {
  // Name of the criterion.
  readonly criterion: string;
  // Score from 0 (no match) to 100 (perfect match).
  readonly score: number;
  // Fact IDs backing this score.
  readonly fact_ids: readonly string[];
}

// A draft first message to the company.
// Rule: it may only cite facts whose status is in CITEABLE_FACT_STATUSES
// and whose provider is not "model".
export interface OutreachDraft {
  // The message text.
  readonly body: string;
  // IDs of the facts the message relies on.
  readonly cited_fact_ids: readonly string[];
}

// The model's overall view of how well a company fits the request.
export interface Assessment {
  // Overall fit from 0 (poor) to 100 (excellent).
  readonly fit_score: number;
  // Score for each criterion.
  readonly criterion_scores: readonly CriterionScore[];
  // Things the model could not confirm or is unsure about.
  readonly uncertainty_notes: readonly string[];
  // Optional first-contact message. Absent if no citeable fact exists.
  readonly outreach?: OutreachDraft;
}

// ---------------------------------------------------------------------------
// Prospect: the three company layers together
// ---------------------------------------------------------------------------

// One company moving through the pipeline. Assessment is added only after
// the company passes validation and gets enriched.
// Identity is raw.crustdata_company_id. Duplicate DETECTION is separate: it
// compares the normalised domain (lowercase, no protocol, no www, no trailing
// slash), falling back to the normalised LinkedIn URL when the domain is
// empty. A match raises a duplicate_domain issue (with related_company_id)
// and the earlier or cheaper record is kept. Two different Crustdata ids
// sharing a domain are a probable duplicate, not proof of identity.
export interface Prospect {
  // Untouched Crustdata data.
  readonly raw: RawCompany;
  // Code-rule verdict.
  readonly validation: Validation;
  // Every fact known about this company, each with a trust level.
  readonly facts: readonly AnyFact[];
  // Model judgement, if one was made.
  readonly assessment?: Assessment;
}

// ---------------------------------------------------------------------------
// Layer 4: Run (one end-to-end execution of the agent)
// ---------------------------------------------------------------------------

// Hard limits that keep a run from costing too much.
export interface RunConfig {
  // Most companies to pull from search. Default 100.
  readonly max_search_results: number;
  // Most companies to send to paid enrichment. Default 15.
  readonly max_enrichments: number;
  // Model used for planning and assessment.
  readonly model: string;
  // Most LLM calls allowed in one run.
  readonly max_llm_calls_per_run: number;
  // Most output tokens allowed in one LLM call.
  readonly max_output_tokens_per_call: number;
}

// Default limits used when the caller sets none. The model and LLM caps are
// starting values to tune.
export const DEFAULT_RUN_CONFIG: RunConfig = {
  max_search_results: 100,
  max_enrichments: 15,
  model: "claude-haiku",
  max_llm_calls_per_run: 20,
  max_output_tokens_per_call: 1500,
};

// Smaller limits for development runs, to keep Crustdata spend low.
export const DEV_RUN_CONFIG: RunConfig = {
  max_search_results: 10,
  max_enrichments: 2,
  model: "claude-haiku",
  max_llm_calls_per_run: 20,
  max_output_tokens_per_call: 1500,
};

// How many companies reached each stage.
export interface RunCounts {
  // Companies returned by search.
  readonly searched: number;
  // Companies that were enriched.
  readonly enriched: number;
  // Companies in the final results.
  readonly delivered: number;
  // LLM calls made.
  readonly llm_calls: number;
  // Input tokens sent across all LLM calls.
  readonly llm_input_tokens: number;
  // Output tokens received across all LLM calls.
  readonly llm_output_tokens: number;
}

// Pipeline step names, used for cost and timing breakdowns.
export type RunStep = "plan" | "search" | "validate" | "enrich" | "assess";

// Dollars spent in each step.
export type RunCosts = Readonly<Record<RunStep, number>>;

// Milliseconds spent in each step.
export type RunTimings = Readonly<Record<RunStep, number>>;

// Record of one agent run.
export interface Run {
  // Unique ID that ties logs and traces to this run.
  readonly trace_id: string;
  // The user's plain-language description of who they want to find.
  readonly input_description: string;
  // Limits this run used.
  readonly config: RunConfig;
  // Stage-by-stage company counts.
  readonly counts: RunCounts;
  // US dollars spent per step.
  readonly cost_usd_by_step: RunCosts;
  // Milliseconds spent per step.
  readonly timings_ms_by_step: RunTimings;
}
