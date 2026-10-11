import { describe, expect, it } from "vitest";
import { checkClaims, isCiteableFact, validateAssessment } from "../../src/core/agent/assessment-checks";
import type { AnyFact, Assessment, FactProvider, FactStatus } from "../../src/core/types";

function fact(id: string, claim: string, status: FactStatus = "given", provider: FactProvider = "fixture"): AnyFact {
  return {
    id,
    value: claim,
    claim,
    source: { provider, retrieved_at: "2026-01-15T09:00:00Z" },
    status,
  };
}

const FACTS: readonly AnyFact[] = [
  fact("1001:name", "Company name is Brightwater Labs"),
  fact("1001:latest_headcount", "Latest headcount is 120"),
  fact("1001:revenue_range", "Revenue range is $10M-$50M", "uncertain"),
  fact("1001:xcheck:website_domain", "Website host matches the primary domain", "cross_checked", "derived"),
  fact("1001:description", "Builds payment APIs", "extracted"),
  fact("1001:model_guess", "Probably raising a Series B", "given", "model"),
];

const CRITERIA = ["Industry: Software", "Company size: 51-200 employees"];

function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    fit_score: 72,
    criterion_scores: [
      { criterion: "Industry: Software", score: 80, fact_ids: ["1001:name"] },
      { criterion: "Company size: 51-200 employees", score: 70, fact_ids: ["1001:latest_headcount"] },
    ],
    uncertainty_notes: [],
    ...overrides,
  };
}

const codes = (r: { findings: readonly { code: string }[] }) => r.findings.map((f) => f.code);

describe("isCiteableFact", () => {
  it("requires a citeable status and a provider other than model", () => {
    const byId = Object.fromEntries(FACTS.map((f) => [f.id, isCiteableFact(f)]));
    expect(byId).toEqual({
      "1001:name": true,
      "1001:latest_headcount": true,
      "1001:revenue_range": false, // uncertain
      "1001:xcheck:website_domain": true, // cross_checked, derived
      "1001:description": false, // extracted
      "1001:model_guess": false, // given, but from the model
    });
  });
});

describe("validateAssessment", () => {
  it("accepts scores in range for exactly the expected criteria", () => {
    expect(validateAssessment(assessment(), FACTS, CRITERIA)).toEqual({ ok: true, findings: [] });
  });

  it("matches criterion names case-insensitively", () => {
    const a = assessment({
      criterion_scores: [
        { criterion: "  industry: software ", score: 80, fact_ids: [] },
        { criterion: "COMPANY SIZE: 51-200 EMPLOYEES", score: 70, fact_ids: [] },
      ],
    });
    expect(validateAssessment(a, FACTS, CRITERIA).ok).toBe(true);
  });

  it.each([-1, 101, 250, Number.NaN, Number.POSITIVE_INFINITY])("rejects fit_score %s", (fit_score) => {
    const r = validateAssessment(assessment({ fit_score }), FACTS, CRITERIA);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain("fit_score_out_of_range");
  });

  it("accepts the range bounds 0 and 100", () => {
    const a = assessment({
      fit_score: 0,
      criterion_scores: [
        { criterion: CRITERIA[0], score: 100, fact_ids: [] },
        { criterion: CRITERIA[1], score: 0, fact_ids: [] },
      ],
    });
    expect(validateAssessment(a, FACTS, CRITERIA).ok).toBe(true);
  });

  it("rejects a criterion score outside 0-100", () => {
    const a = assessment({
      criterion_scores: [
        { criterion: CRITERIA[0], score: 140, fact_ids: [] },
        { criterion: CRITERIA[1], score: 70, fact_ids: [] },
      ],
    });
    expect(codes(validateAssessment(a, FACTS, CRITERIA))).toEqual(["criterion_score_out_of_range"]);
  });

  it("rejects missing, unexpected and duplicate criteria", () => {
    const a = assessment({
      criterion_scores: [
        { criterion: CRITERIA[0], score: 80, fact_ids: [] },
        { criterion: CRITERIA[0], score: 60, fact_ids: [] },
        { criterion: "Vibes", score: 90, fact_ids: [] },
      ],
    });
    const r = validateAssessment(a, FACTS, CRITERIA);
    expect(r.ok).toBe(false);
    expect(codes(r).sort()).toEqual(["duplicate_criterion", "missing_criterion", "unexpected_criterion"]);
  });

  it("rejects references to facts that do not exist for this company", () => {
    const a = assessment({
      criterion_scores: [
        { criterion: CRITERIA[0], score: 80, fact_ids: ["1007:name"] },
        { criterion: CRITERIA[1], score: 70, fact_ids: ["1001:funding"] },
      ],
    });
    const r = validateAssessment(a, FACTS, CRITERIA);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => [f.code, f.fact_id])).toEqual([
      ["unknown_fact_reference", "1007:name"],
      ["unknown_fact_reference", "1001:funding"],
    ]);
  });

  it("allows an uncertain fact in a score but records a warning", () => {
    const a = assessment({
      criterion_scores: [
        { criterion: CRITERIA[0], score: 80, fact_ids: ["1001:name"] },
        { criterion: CRITERIA[1], score: 30, fact_ids: ["1001:revenue_range"] },
      ],
    });
    const r = validateAssessment(a, FACTS, CRITERIA);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([
      expect.objectContaining({ code: "uncertain_fact_reference", severity: "warning", fact_id: "1001:revenue_range" }),
    ]);
  });
});

describe("checkClaims", () => {
  it("accepts outreach that cites citeable facts and states only their numbers", () => {
    const r = checkClaims(
      { body: "Hi Brightwater Labs team, a company of 120 people.", cited_fact_ids: ["1001:name", "1001:latest_headcount"] },
      FACTS,
    );
    expect(r).toEqual({ ok: true, findings: [] });
  });

  it("accepts a cross_checked derived fact", () => {
    const r = checkClaims({ body: "Your site checks out.", cited_fact_ids: ["1001:xcheck:website_domain"] }, FACTS);
    expect(r.ok).toBe(true);
  });

  it("requires at least one citation", () => {
    expect(codes(checkClaims({ body: "Hello!", cited_fact_ids: [] }, FACTS))).toEqual(["no_citations"]);
  });

  it("rejects unknown citations", () => {
    const r = checkClaims({ body: "Hello!", cited_fact_ids: ["9999:revenue"] }, FACTS);
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(["unknown_citation"]);
  });

  it("rejects uncertain and extracted facts", () => {
    const r = checkClaims({ body: "Hello!", cited_fact_ids: ["1001:revenue_range", "1001:description"] }, FACTS);
    expect(r.findings.map((f) => [f.code, f.fact_id])).toEqual([
      ["non_citeable_citation", "1001:revenue_range"],
      ["non_citeable_citation", "1001:description"],
    ]);
  });

  it("rejects facts provided by the model even with a citeable status", () => {
    const r = checkClaims({ body: "Hello!", cited_fact_ids: ["1001:model_guess"] }, FACTS);
    expect(codes(r)).toEqual(["model_fact_citation"]);
  });

  it("rejects numbers that no cited citeable fact supports", () => {
    const r = checkClaims(
      { body: "Congrats on raising $50M with 120 staff.", cited_fact_ids: ["1001:latest_headcount"] },
      FACTS,
    );
    expect(r.ok).toBe(false);
    expect(r.findings).toEqual([expect.objectContaining({ code: "unsupported_number", message: expect.stringContaining('"50"') })]);
  });

  it("does not let an uncited or uncertain fact support a number", () => {
    // $10M appears only in the uncertain revenue fact.
    const r = checkClaims(
      { body: "At $10M revenue you are growing fast.", cited_fact_ids: ["1001:name", "1001:revenue_range"] },
      FACTS,
    );
    expect(codes(r).sort()).toEqual(["non_citeable_citation", "unsupported_number"]);
  });

  it("warns about a fact cited twice", () => {
    const r = checkClaims({ body: "Hi!", cited_fact_ids: ["1001:name", "1001:name"] }, FACTS);
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual(["duplicate_citation"]);
  });
});
