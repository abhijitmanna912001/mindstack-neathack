// Human-readable labels for the pipeline's status and reason codes. Unknown
// codes fall back to the code itself, so nothing is hidden.

export type Tone = "good" | "warn" | "bad" | "neutral" | "info";

const label = (map: Record<string, string>) => (code: string) => map[code] ?? code.replace(/_/g, " ");

export const validationLabel = label({ valid: "Valid", flagged: "Flagged", rejected: "Rejected" });

export function validationTone(status: string | null): Tone {
  return status === "valid" ? "good" : status === "flagged" ? "warn" : status === "rejected" ? "bad" : "neutral";
}

export const enrichmentLabel = label({
  enriched: "Enriched",
  not_returned: "Not returned by enrichment",
  skipped_budget: "Not enriched (cap reached)",
  skipped_no_linkedin: "Not enriched (no LinkedIn URL)",
  skipped_ineligible: "Not enriched (rejected)",
  failed: "Enrichment failed",
});

export const notAssessedLabel = label({
  rejected: "Not assessed: rejected by validation",
  duplicate: "Not assessed: duplicate record",
  not_enriched: "Not assessed: not enriched",
  llm_call_cap: "Not assessed: model-call cap reached",
  llm_stopped: "Not assessed: model calls stopped after an error",
});

export const failedLabel = label({
  invalid_assessment: "Assessment failed validation",
  malformed_output: "Model output could not be parsed",
  truncated: "Model output was truncated",
  llm_error: "Model call failed",
});

export function factStatusTone(status: string): Tone {
  return status === "given" || status === "cross_checked" ? "good" : status === "uncertain" ? "warn" : "neutral";
}
