// Schema and validator for Abhijit's official evidence summary
// (evidence/summary.json at the repository root). The figures come only from
// that file: this module validates what it states and passes through known,
// well-formed values. It never computes, derives or fills in a figure, and a
// metric missing from a run stays missing ("not reported").

export type MetricUnit = "count" | "usd";

export type MetricGroup = "enrichment" | "assessment" | "outreach" | "model" | "provider";

// The run metrics this page knows how to show, in display order, with the
// keys used by evidence/summary.json. Any other key is ignored.
export const EVIDENCE_METRICS = [
  { key: "enrichments", label: "Enrichments used", group: "enrichment", unit: "count" },
  { key: "wasted_enrichments", label: "Wasted enrichments", group: "enrichment", unit: "count" },
  { key: "valid_companies_enriched", label: "Valid companies enriched", group: "enrichment", unit: "count" },
  { key: "rejected_before_enrichment", label: "Rejected before enrichment", group: "enrichment", unit: "count" },
  { key: "duplicates_removed", label: "Duplicates removed", group: "enrichment", unit: "count" },
  { key: "assessed", label: "Assessed (scored)", group: "assessment", unit: "count" },
  { key: "assessed_valid", label: "Assessed: valid", group: "assessment", unit: "count" },
  { key: "assessed_flagged", label: "Assessed: flagged", group: "assessment", unit: "count" },
  { key: "assessed_should_be_rejected", label: "Assessed: should have been rejected", group: "assessment", unit: "count" },
  { key: "assessments_failed", label: "Assessments failed", group: "assessment", unit: "count" },
  { key: "outreach_drafts", label: "Outreach drafts", group: "outreach", unit: "count" },
  { key: "cited_fact_ids", label: "Cited fact IDs", group: "outreach", unit: "count" },
  { key: "cited_not_citeable", label: "Cited IDs that are not citeable", group: "outreach", unit: "count" },
  { key: "drafts_with_violations", label: "Drafts with citation violations", group: "outreach", unit: "count" },
  { key: "outreach_suppressed", label: "Outreach suppressed by guards", group: "outreach", unit: "count" },
  { key: "guard_findings", label: "Guard findings", group: "outreach", unit: "count" },
  { key: "model_calls", label: "Model calls", group: "model", unit: "count" },
  { key: "tokens_in", label: "Input tokens", group: "model", unit: "count" },
  { key: "tokens_out", label: "Output tokens", group: "model", unit: "count" },
  { key: "model_cost_usd", label: "Recorded model cost", group: "model", unit: "usd" },
  { key: "provider_cost_usd", label: "Simulated provider cost", group: "provider", unit: "usd" },
] as const satisfies readonly { key: string; label: string; group: MetricGroup; unit: MetricUnit }[];

export type EvidenceMetricKey = (typeof EVIDENCE_METRICS)[number]["key"];

export const METRIC_GROUP_LABELS: Record<MetricGroup, string> = {
  enrichment: "Enrichment",
  assessment: "Assessment",
  outreach: "Outreach and citations",
  model: "Model usage",
  provider: "Provider",
};

// Only the metrics the file states for that run.
export type RunMetrics = Partial<Record<EvidenceMetricKey, number>>;

export interface EvidenceSummary {
  readonly scenario: string;
  readonly source_reports: readonly string[];
  readonly provider_cost_basis: string;
  readonly baseline: RunMetrics;
  readonly improved: RunMetrics;
  readonly notes: readonly string[];
}

export interface ValidationCounts {
  readonly valid: number;
  readonly flagged: number;
  readonly rejected: number;
}

// The live-data (real provider data) evaluation in real_data. Only these
// approved counts and strings are kept; any other field is ignored.
export interface LiveDataEvidence {
  readonly source: string;
  readonly slice: string;
  readonly searched: number;
  readonly enriched_in_both_pipelines: number;
  readonly search_stage_validation: ValidationCounts;
  readonly after_enrichment_validation: ValidationCounts;
  readonly valid_to_flagged: number;
  // Rule code -> times it fired, in the file's order.
  readonly rules_fired: readonly { readonly code: string; readonly count: number }[];
  readonly baseline_revalidates_after_enrichment: boolean;
  readonly improved_assessed: { readonly valid: number; readonly flagged: number };
  readonly provider_cost_usd_measured_per_run: number;
  readonly caveat: string;
  // Read from the source text: whether it states the fake model, no model
  // calls and tracing off. The page only says so when the file does.
  readonly source_states_no_real_model: boolean;
}

// real_data is null until a live-data evaluation exists. A malformed value
// is rejected as a whole: nothing partial is ever shown.
export type LiveDataState =
  | { readonly state: "pending" }
  | { readonly state: "invalid"; readonly errors: readonly string[] }
  | { readonly state: "ready"; readonly data: LiveDataEvidence };

export type EvidenceState =
  | { readonly state: "invalid"; readonly errors: readonly string[] }
  | { readonly state: "ready"; readonly summary: EvidenceSummary; readonly live_data: LiveDataState };

const MAX_TEXT = 400;
const MAX_NOTE = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= max;
}

function isTextList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.every((v) => isText(v, max));
}

function readRun(name: "baseline" | "improved", value: unknown, errors: string[]): RunMetrics | undefined {
  if (!isRecord(value)) {
    errors.push(`${name} must be an object.`);
    return undefined;
  }
  const metrics: RunMetrics = {};
  for (const { key, unit } of EVIDENCE_METRICS) {
    const raw = value[key];
    if (raw === undefined) continue;
    const ok =
      typeof raw === "number" &&
      Number.isFinite(raw) &&
      raw >= 0 &&
      (unit === "usd" || Number.isInteger(raw));
    if (!ok) {
      errors.push(`${name}.${key} must be a non-negative ${unit === "count" ? "integer" : "number"}.`);
      continue;
    }
    metrics[key] = raw;
  }
  if (Object.keys(metrics).length === 0) errors.push(`${name} states none of the known metrics.`);
  return metrics;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// Rule codes look like "size_headcount_mismatch:latest_headcount": letters,
// underscores, dots and one colon. No digits, so a company id or record
// value can never pass as a rule code.
const RULE_CODE = /^[a-z][a-z_]*(?::[a-z][a-z_.]*)?$/;
const MAX_RULE_CODE = 80;

function readValidationCounts(name: string, value: unknown, errors: string[]): ValidationCounts | undefined {
  if (!isRecord(value)) {
    errors.push(`real_data.${name} must be an object.`);
    return undefined;
  }
  for (const key of ["valid", "flagged", "rejected"] as const) {
    if (!isCount(value[key])) errors.push(`real_data.${name}.${key} must be a non-negative integer.`);
  }
  return isCount(value.valid) && isCount(value.flagged) && isCount(value.rejected)
    ? { valid: value.valid, flagged: value.flagged, rejected: value.rejected }
    : undefined;
}

export function parseLiveData(input: unknown): LiveDataState {
  if (input === null) return { state: "pending" };
  if (!isRecord(input)) return { state: "invalid", errors: ["real_data must be null or an object."] };
  const errors: string[] = [];

  for (const key of ["source", "slice"] as const) {
    if (!isText(input[key])) errors.push(`real_data.${key} must be a non-empty string.`);
  }
  if (!isText(input.caveat, MAX_NOTE)) errors.push("real_data.caveat must be a non-empty string.");
  for (const key of ["searched", "enriched_in_both_pipelines"] as const) {
    if (!isCount(input[key])) errors.push(`real_data.${key} must be a non-negative integer.`);
  }
  const search = readValidationCounts("search_stage_validation", input.search_stage_validation, errors);
  const after = readValidationCounts("after_enrichment_validation", input.after_enrichment_validation, errors);

  const changed = input.changed_by_enrichment;
  if (!isRecord(changed) || !isCount(changed.valid_to_flagged)) {
    errors.push("real_data.changed_by_enrichment.valid_to_flagged must be a non-negative integer.");
  }

  const rules: { code: string; count: number }[] = [];
  if (!isRecord(input.rules_fired)) {
    errors.push("real_data.rules_fired must be an object.");
  } else {
    for (const [code, count] of Object.entries(input.rules_fired)) {
      if (code.length > MAX_RULE_CODE || !RULE_CODE.test(code)) {
        errors.push("real_data.rules_fired contains a key that is not a rule code.");
      } else if (!isCount(count)) {
        errors.push(`real_data.rules_fired.${code} must be a non-negative integer.`);
      } else {
        rules.push({ code, count });
      }
    }
  }

  if (typeof input.baseline_revalidates_after_enrichment !== "boolean") {
    errors.push("real_data.baseline_revalidates_after_enrichment must be true or false.");
  }
  const assessed = input.improved_assessed;
  if (!isRecord(assessed) || !isCount(assessed.valid) || !isCount(assessed.flagged)) {
    errors.push("real_data.improved_assessed must have non-negative integer valid and flagged counts.");
  }
  const cost = input.provider_cost_usd_measured_per_run;
  if (!(typeof cost === "number" && Number.isFinite(cost) && cost >= 0)) {
    errors.push("real_data.provider_cost_usd_measured_per_run must be a non-negative number.");
  }

  if (errors.length > 0 || !search || !after) return { state: "invalid", errors };
  const source = input.source as string;
  const lower = source.toLowerCase();
  return {
    state: "ready",
    data: {
      source,
      slice: input.slice as string,
      searched: input.searched as number,
      enriched_in_both_pipelines: input.enriched_in_both_pipelines as number,
      search_stage_validation: search,
      after_enrichment_validation: after,
      valid_to_flagged: (changed as Record<string, number>).valid_to_flagged,
      rules_fired: rules,
      baseline_revalidates_after_enrichment: input.baseline_revalidates_after_enrichment as boolean,
      improved_assessed: {
        valid: (assessed as Record<string, number>).valid,
        flagged: (assessed as Record<string, number>).flagged,
      },
      provider_cost_usd_measured_per_run: cost as number,
      caveat: input.caveat as string,
      source_states_no_real_model:
        lower.includes("fake model") && lower.includes("no model calls") && lower.includes("tracing off"),
    },
  };
}

export function parseEvidenceSummary(input: unknown): EvidenceState {
  if (!isRecord(input)) {
    return { state: "invalid", errors: ["The evidence summary must be a JSON object."] };
  }
  const errors: string[] = [];
  if (!isText(input.scenario)) errors.push("scenario must be a non-empty string.");
  if (!isTextList(input.source_reports, MAX_TEXT) || input.source_reports.length === 0) {
    errors.push("source_reports must be a non-empty list of strings.");
  }
  if (!isText(input.provider_cost_basis)) errors.push("provider_cost_basis must be a non-empty string.");
  if (!isTextList(input.notes, MAX_NOTE)) errors.push("notes must be a list of strings.");
  if (!("real_data" in input)) errors.push("real_data must be present (null while pending).");
  const baseline = readRun("baseline", input.baseline, errors);
  const improved = readRun("improved", input.improved, errors);

  if (errors.length > 0 || !baseline || !improved) return { state: "invalid", errors };
  return {
    state: "ready",
    summary: {
      scenario: input.scenario as string,
      source_reports: [...(input.source_reports as string[])],
      provider_cost_basis: input.provider_cost_basis as string,
      baseline,
      improved,
      notes: [...(input.notes as string[])],
    },
    live_data: parseLiveData(input.real_data),
  };
}
