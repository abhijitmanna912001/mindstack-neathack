// Builds the assessment prompt and parses the model's reply into the shared
// Assessment shape. The parse checks structure only, so the result can be
// typed; judging the content (score ranges, cited fact ids) is the job of
// validateAssessment() and checkClaims(), which the baseline does not run.

import type { Assessment, CriterionScore, OutreachDraft } from "../types";
import type { LlmMessage } from "./llm";
import type { BaselineProspect, IcpInput } from "./types";

const SYSTEM_PROMPT = `You are SignalScout, a B2B prospect qualification assistant.
Assess how well one company fits the user's ideal customer profile and draft a short first outreach message.

Reply with one JSON object and nothing else, in exactly this shape:
{
  "fit_score": <integer 0-100>,
  "criterion_scores": [
    { "criterion": "<one of the listed criteria>", "score": <integer 0-100>, "fact_ids": ["<fact id>"] }
  ],
  "uncertainty_notes": ["<anything you could not confirm>"],
  "outreach": { "body": "<message under 120 words>", "cited_fact_ids": ["<fact id>"] }
}

A fact id is "<crustdata_company_id>:<field>", naming a field present in the company record, e.g. "1001:industry".
Omit "outreach" if the record gives you nothing specific to say.`;

export function buildAssessmentMessages(
  icp_description: string,
  criteria: readonly string[],
  icp: IcpInput,
  prospect: Pick<BaselineProspect, "raw" | "enrichment">,
): readonly LlmMessage[] {
  const lines = [
    `Ideal customer profile: ${icp_description}`,
    `Criteria to score:\n${criteria.length > 0 ? criteria.map((c) => `- ${c}`).join("\n") : "- Overall fit"}`,
  ];
  if (icp.excluded_domains.length > 0) {
    lines.push(`The user wants to exclude these domains: ${icp.excluded_domains.join(", ")}`);
  }
  lines.push(
    `Enrichment status: ${prospect.enrichment.status}`,
    `Company record (JSON):\n${JSON.stringify(prospect.raw, null, 2)}`,
  );
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n\n") },
  ];
}

export type ParsedAssessment =
  | { readonly ok: true; readonly assessment: Assessment }
  | { readonly ok: false; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Models often wrap JSON in a ```json fence; accept that, nothing looser.
function stripCodeFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text.trim());
  return fenced ? fenced[1] : text.trim();
}

export function parseAssessment(text: string): ParsedAssessment {
  let data: unknown;
  try {
    data = JSON.parse(stripCodeFence(text));
  } catch {
    return { ok: false, message: "Model output is not valid JSON." };
  }
  if (!isRecord(data)) return { ok: false, message: "Model output is not a JSON object." };

  if (!isFiniteNumber(data.fit_score)) {
    return { ok: false, message: "fit_score is missing or not a number." };
  }
  if (!Array.isArray(data.criterion_scores)) {
    return { ok: false, message: "criterion_scores is missing or not an array." };
  }
  const criterion_scores: CriterionScore[] = [];
  for (const item of data.criterion_scores) {
    if (
      !isRecord(item) ||
      typeof item.criterion !== "string" ||
      !isFiniteNumber(item.score) ||
      !isStringArray(item.fact_ids)
    ) {
      return { ok: false, message: "A criterion score is not { criterion, score, fact_ids }." };
    }
    criterion_scores.push({
      criterion: item.criterion,
      score: item.score,
      fact_ids: item.fact_ids,
    });
  }
  if (!isStringArray(data.uncertainty_notes)) {
    return { ok: false, message: "uncertainty_notes is missing or not a list of strings." };
  }

  let outreach: OutreachDraft | undefined;
  if (data.outreach !== undefined && data.outreach !== null) {
    if (
      !isRecord(data.outreach) ||
      typeof data.outreach.body !== "string" ||
      !isStringArray(data.outreach.cited_fact_ids)
    ) {
      return { ok: false, message: "outreach is not { body, cited_fact_ids }." };
    }
    outreach = { body: data.outreach.body, cited_fact_ids: data.outreach.cited_fact_ids };
  }

  return {
    ok: true,
    assessment: {
      fit_score: data.fit_score,
      criterion_scores,
      uncertainty_notes: data.uncertainty_notes,
      ...(outreach ? { outreach } : {}),
    },
  };
}
