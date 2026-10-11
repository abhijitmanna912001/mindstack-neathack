import { describe, expect, it } from "vitest";
import { buildAssessmentMessages, parseAssessment } from "../../src/core/agent/assess";
import { FIXTURE_COMPANIES } from "../../src/core/fixtures/companies";
import { icp } from "./helpers";

const valid = {
  fit_score: 72,
  criterion_scores: [{ criterion: "Industry", score: 80, fact_ids: ["1001:industry"] }],
  uncertainty_notes: ["Revenue not confirmed."],
  outreach: { body: "Hi Brightwater team.", cited_fact_ids: ["1001:name"] },
};

describe("parseAssessment", () => {
  it("accepts a well-formed assessment", () => {
    expect(parseAssessment(JSON.stringify(valid))).toEqual({ ok: true, assessment: valid });
  });

  it("accepts a ```json fenced reply", () => {
    expect(parseAssessment("```json\n" + JSON.stringify(valid) + "\n```").ok).toBe(true);
  });

  it("treats outreach as optional, including null", () => {
    const withoutOutreach = { ...valid, outreach: null };
    const parsed = parseAssessment(JSON.stringify(withoutOutreach));
    expect(parsed.ok && parsed.assessment.outreach).toBeUndefined();
  });

  it("drops fields that are not part of Assessment", () => {
    const parsed = parseAssessment(JSON.stringify({ ...valid, verdict: "buy" }));
    expect(parsed.ok && Object.keys(parsed.assessment).sort()).toEqual([
      "criterion_scores",
      "fit_score",
      "outreach",
      "uncertainty_notes",
    ]);
  });

  it.each([
    ["prose", "Looks like a good fit!"],
    ["an array", "[1, 2]"],
    ["missing fit_score", JSON.stringify({ ...valid, fit_score: undefined })],
    ["string fit_score", JSON.stringify({ ...valid, fit_score: "72" })],
    ["bad criterion", JSON.stringify({ ...valid, criterion_scores: [{ criterion: "x", score: 1 }] })],
    ["bad notes", JSON.stringify({ ...valid, uncertainty_notes: "none" })],
    ["bad outreach", JSON.stringify({ ...valid, outreach: { body: 3, cited_fact_ids: [] } })],
  ])("rejects %s", (_label, text) => {
    expect(parseAssessment(text).ok).toBe(false);
  });

  // The baseline checks shape only; content checks come with validateAssessment().
  it("does not judge score ranges or cited fact ids", () => {
    const odd = { ...valid, fit_score: 250, outreach: { body: "x", cited_fact_ids: ["made-up"] } };
    expect(parseAssessment(JSON.stringify(odd)).ok).toBe(true);
  });
});

describe("buildAssessmentMessages", () => {
  it("includes the ICP, criteria, enrichment status and raw record", () => {
    const messages = buildAssessmentMessages(
      "Companies in Software.",
      ["Industry: Software"],
      icp({ industry: "Software", excluded_domains: ["rival.example"] }),
      { raw: FIXTURE_COMPANIES[0], enrichment: { status: "enriched" } },
    );
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    const user = messages[1].content;
    expect(user).toContain("Companies in Software.");
    expect(user).toContain("- Industry: Software");
    expect(user).toContain("rival.example");
    expect(user).toContain("Enrichment status: enriched");
    expect(user).toContain('"crustdata_company_id": 1001');
  });
});
