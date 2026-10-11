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

// real_data is null until a live-data evaluation exists. A non-null value
// has no agreed schema yet, so it is acknowledged but never rendered.
export type LiveDataState = { readonly state: "pending" } | { readonly state: "unsupported" };

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
    live_data: input.real_data === null ? { state: "pending" } : { state: "unsupported" },
  };
}
