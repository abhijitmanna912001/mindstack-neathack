// Fixed, code-based text for the live results DTO. Free-text fields in a
// pipeline result can carry upstream, model-error or company text (for
// example a failed assessment's message holds the model client's error, and
// validation reasons quote record values). The live DTO never forwards them:
// each message is chosen here by its code or reason, independently of any
// scrubbing the server does first.

import type {
  AssessmentDto,
  FindingDto,
  OutreachDto,
  ProspectDto,
} from "../../results/_lib/presentation";

const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  industry_not_recognised: "The industry was not recognised.",
  industry_autocomplete_failed: "The industry could not be matched.",
  extra_locations_ignored: "Only the first location was searched.",
  search_budget_exhausted: "The search budget was reached.",
  search_no_match: "No companies matched the search.",
  search_failed: "The company search failed.",
  enrich_budget_exhausted: "The enrichment budget was reached before every company was enriched.",
  enrich_no_results: "No companies could be enriched, so results use basic search data only.",
  enrich_partial: "Some companies could not be enriched, so those use basic search data only.",
  enrich_failed: "Enrichment failed, so results use basic search data only.",
  llm_call_cap_reached: "The model-call limit was reached, so some companies were not assessed.",
  llm_stopped: "Assessment stopped early after a model error, so some companies were not assessed.",
  llm_cost_incomplete: "Model cost could not be measured for every model call.",
};
export const GENERIC_ISSUE_MESSAGE = "A step of the run reported a problem.";

const FAILED_ASSESSMENT_MESSAGES: Readonly<Record<string, string>> = {
  llm_error: "The model call did not return an answer.",
  malformed_output: "The model's answer could not be read.",
  truncated: "The model's answer was cut off.",
  invalid_assessment: "The model's assessment failed the checks.",
};
export const GENERIC_ASSESSMENT_MESSAGE = "The assessment failed.";

const FINDING_MESSAGES: Readonly<Record<string, string>> = {
  fit_score_out_of_range: "The fit score is outside 0-100.",
  criterion_score_out_of_range: "A criterion score is outside 0-100.",
  missing_criterion: "A requested criterion was not scored.",
  unexpected_criterion: "A criterion was scored that was not requested.",
  duplicate_criterion: "A criterion was scored more than once.",
  unknown_fact_reference: "A score references an unknown fact.",
  uncertain_fact_reference: "A score references an uncertain fact.",
  no_citations: "The outreach cites no facts.",
  duplicate_citation: "The outreach cites a fact more than once.",
  unknown_citation: "The outreach cites an unknown fact.",
  model_fact_citation: "The outreach cites a model-written fact.",
  non_citeable_citation: "The outreach cites a fact that cannot be cited.",
  unsupported_number: "The outreach states a number no cited fact supports.",
};
export const GENERIC_FINDING_MESSAGE = "The assessment failed a check.";

const VALIDATION_REASONS: Readonly<Record<string, string>> = {
  missing_name: "The company has no name.",
  missing_domain: "The company has no primary domain.",
  missing_linkedin: "The company has no LinkedIn page.",
  junk_website: "The website is not a company site.",
  duplicate_domain: "The company duplicates another result.",
  // Raised for a headcount outside the size range and for an implausible
  // revenue per employee.
  size_headcount_mismatch: "The listed size, headcount or revenue do not agree.",
};
export const GENERIC_VALIDATION_REASON = "The company failed a data check.";

// Codes and field names are identifiers from the pipeline. Anything that does
// not look like one is replaced, so no free text can ride in on them.
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;
export const UNKNOWN_CODE = "unknown";
export const safeCode = (value: string): string => (IDENTIFIER.test(value) ? value : UNKNOWN_CODE);

const pick = (table: Readonly<Record<string, string>>, code: string, fallback: string): string =>
  Object.hasOwn(table, code) ? table[code] : fallback;

export const issueMessage = (code: string) => pick(ISSUE_MESSAGES, code, GENERIC_ISSUE_MESSAGE);
export const failedAssessmentMessage = (reason: string) =>
  pick(FAILED_ASSESSMENT_MESSAGES, reason, GENERIC_ASSESSMENT_MESSAGE);
export const findingMessage = (code: string) => pick(FINDING_MESSAGES, code, GENERIC_FINDING_MESSAGE);
export const validationReason = (code: string) => pick(VALIDATION_REASONS, code, GENERIC_VALIDATION_REASON);

// Code, severity and a fixed message only: never the finding's own message,
// fact_id or criterion.
function safeFinding(f: FindingDto): FindingDto {
  return {
    code: safeCode(f.code),
    severity: f.severity === "error" ? "error" : "warning",
    message: findingMessage(f.code),
  };
}

function safeAssessment(a: AssessmentDto): AssessmentDto {
  switch (a.status) {
    case "assessed":
      return {
        status: "assessed",
        fit_score: a.fit_score,
        criterion_scores: a.criterion_scores.map((s) => ({
          criterion: s.criterion,
          score: s.score,
          fact_ids: [...s.fact_ids],
        })),
        uncertainty_notes: [...a.uncertainty_notes],
      };
    case "failed":
      return { status: "failed", reason: safeCode(a.reason), message: failedAssessmentMessage(a.reason) };
    case "not_assessed":
      return { status: "not_assessed", reason: safeCode(a.reason) };
  }
}

function safeOutreach(o: OutreachDto): OutreachDto {
  switch (o.state) {
    case "kept":
      return { state: "kept", body: o.body, cited_fact_ids: [...o.cited_fact_ids] };
    case "suppressed":
      return { state: "suppressed", findings: o.findings.map(safeFinding) };
    case "none":
      return { state: "none" };
  }
}

// Rebuilds a ProspectDto field by field with every message replaced by fixed
// text. Company data, facts, scores and the kept outreach are the payload and
// are copied as values.
export function safeProspect(p: ProspectDto): ProspectDto {
  return {
    company_id: p.company_id,
    display_name: p.display_name,
    search_validation_status: p.search_validation_status,
    validation: {
      status: p.validation.status,
      issues: p.validation.issues.map((issue) => ({
        code: safeCode(issue.code),
        field: safeCode(issue.field),
        reason: validationReason(issue.code),
        ...(issue.related_company_id !== undefined ? { related_company_id: issue.related_company_id } : {}),
      })),
    },
    enrichment_status: p.enrichment_status,
    assessment: safeAssessment(p.assessment),
    facts: p.facts.map((f) => ({
      id: f.id,
      claim: f.claim,
      status: f.status,
      provider: f.provider,
      citeable: f.citeable,
    })),
    outreach: safeOutreach(p.outreach),
    guard: {
      assessment_findings: p.guard.assessment_findings.map(safeFinding),
      claim_findings: p.guard.claim_findings.map(safeFinding),
    },
  };
}
