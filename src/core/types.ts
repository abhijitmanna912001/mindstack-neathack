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
// Layer 3: Assessment (model-written judgement, grounded in evidence)
// ---------------------------------------------------------------------------

// How much we trust a piece of evidence:
// "given" = the user stated it in their request,
// "extracted" = read from one raw field,
// "cross_checked" = confirmed by two or more sources,
// "uncertain" = a guess or weakly supported.
export type EvidenceStatus =
  | "given"
  | "extracted"
  | "cross_checked"
  | "uncertain";

// One factual claim the assessment relies on.
export interface Evidence {
  // Short unique ID within the assessment, e.g. "e1".
  readonly id: string;
  // The claim in plain English, e.g. "Has about 120 employees".
  readonly claim: string;
  // The raw fields this claim rests on, e.g. ["latest_headcount"].
  // "cross_checked" evidence needs at least two fields; "given" or
  // "extracted" evidence needs at least one.
  readonly source_fields: readonly (keyof RawCompany)[];
  // How trustworthy the claim is.
  readonly status: EvidenceStatus;
}

// A score for one criterion from the user's request (e.g. "right size").
export interface CriterionScore {
  // Name of the criterion.
  readonly criterion: string;
  // Score from 0 (no match) to 100 (perfect match).
  readonly score: number;
  // Evidence IDs backing this score.
  readonly evidence_ids: readonly string[];
}

// A draft first message to the company.
// Rule: it may only cite evidence whose status is "given" or "cross_checked".
export interface OutreachDraft {
  // The message text.
  readonly body: string;
  // IDs of the evidence items the message relies on.
  readonly cited_evidence_ids: readonly string[];
}

// The model's overall view of how well a company fits the request.
export interface Assessment {
  // Overall fit from 0 (poor) to 100 (excellent).
  readonly fit_score: number;
  // Score for each criterion.
  readonly criterion_scores: readonly CriterionScore[];
  // All facts used, each with a trust level.
  readonly evidence: readonly Evidence[];
  // Things the model could not confirm or is unsure about.
  readonly uncertainty_notes: readonly string[];
  // Optional first-contact message. Absent if no safe evidence to cite.
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
}

// Default limits used when the caller sets none.
export const DEFAULT_RUN_CONFIG: RunConfig = {
  max_search_results: 100,
  max_enrichments: 15,
};

// How many companies reached each stage.
export interface RunCounts {
  // Companies returned by search.
  readonly searched: number;
  // Companies that were enriched.
  readonly enriched: number;
  // Companies in the final results.
  readonly delivered: number;
}

// Pipeline step names, used for cost and timing breakdowns.
export type RunStep = "search" | "validate" | "enrich" | "assess";

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
