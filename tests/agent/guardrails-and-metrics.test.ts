// The improved pipeline's four GUARDRAIL span types and its run metrics,
// against the synthetic fixtures and the fake LLM. No network.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as agent from "../../src/core/agent";
import { readFactsPrompt } from "../../src/core/agent/facts-prompt";
import { defaultFakeFactsAssessment, type FakeLlmResponder } from "../../src/core/agent/fake-llm";
import { runImprovedPipeline } from "../../src/core/agent/improved-pipeline";
import type { LlmRequest } from "../../src/core/agent/llm";
import { FIXTURE_COMPANIES } from "../../src/core/fixtures/companies";
import { EVIDENCE_CONFIG, OPEN_ICP, type RecordedSpan, flattenSpans, harness } from "./helpers";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const GUARDRAILS = ["validate_companies", "build_facts", "validate_assessment", "check_claims"];

const companyOf = (request: LlmRequest) => readFactsPrompt(request.messages)?.data.company_id;

function replyFor(replies: Record<number, string>): FakeLlmResponder {
  return (request) => {
    const id = companyOf(request);
    return id !== undefined && replies[id] !== undefined ? replies[id] : defaultFakeFactsAssessment(request);
  };
}

const assessmentJson = (id: number, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    fit_score: 70,
    criterion_scores: [{ criterion: "Overall fit", score: 70, fact_ids: [`${id}:name`] }],
    uncertainty_notes: [],
    outreach: { body: "Hello from SignalScout.", cited_fact_ids: [`${id}:name`] },
    ...overrides,
  });

// Everything a span exposes, as text, for checking nothing raw leaks.
const spanText = (spans: readonly RecordedSpan[]) =>
  JSON.stringify(spans.map((s) => ({ input: s.input, attributes: s.attributes, events: s.events })));

describe("guardrail spans", () => {
  it("records all four as GUARDRAIL spans through the tracer", async () => {
    const h = harness(EVIDENCE_CONFIG);
    await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const spans = flattenSpans(h.roots);
    for (const name of GUARDRAILS) {
      const matching = spans.filter((s) => s.name === name);
      expect(matching.length, name).toBeGreaterThan(0);
      expect(matching.every((s) => s.kind === "GUARDRAIL"), name).toBe(true);
    }
    // Two validation passes (search records, then enriched records) and one
    // assessment and claim check per assessed company.
    expect(spans.filter((s) => s.name === "validate_companies")).toHaveLength(2);
    expect(spans.filter((s) => s.name === "validate_assessment")).toHaveLength(5);
    expect(spans.filter((s) => s.name === "check_claims")).toHaveLength(5);
  });

  it("puts counts, statuses and company ids on validate_companies", async () => {
    const h = harness(EVIDENCE_CONFIG);
    await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const [search] = flattenSpans(h.roots).filter((s) => s.name === "validate_companies");
    expect(search.attributes).toMatchObject({
      "validation.phase": "search",
      "validation.valid_count": 3,
      "validation.flagged_count": 5,
      "validation.rejected_count": 2,
      "validation.flagged_ids": [1002, 1003, 1006, 1008, 1009],
      "validation.rejected_ids": [1005, 1010],
      "validation.duplicate_ids": [1005],
    });
  });

  it("puts fact counts and provenance on build_facts", async () => {
    const h = harness(EVIDENCE_CONFIG);
    await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const span = flattenSpans(h.roots).find((s) => s.name === "build_facts")!;
    expect(span.attributes).toMatchObject({
      "facts.provider": "fixture",
      "facts.empty_company_ids": [1005, 1010],
    });
    expect(span.attributes["facts.total"]).toBeGreaterThan(span.attributes["facts.citeable"] as number);
    expect(span.attributes["facts.uncertain"]).toBeGreaterThan(0);
  });

  it("puts the outcome and offending ids on validate_assessment and check_claims", async () => {
    const h = harness(EVIDENCE_CONFIG, {
      llm: {
        respond: replyFor({
          1001: assessmentJson(1001, { fit_score: 150 }),
          1003: assessmentJson(1003, { outreach: { body: "Nice site.", cited_fact_ids: ["1003:website"] } }),
        }),
      },
    });
    await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const spans = flattenSpans(h.roots);
    const assessFor = (id: number) => spans.find((s) => s.name === "validate_assessment" && s.attributes["company.id"] === id)!;
    const claimsFor = (id: number) => spans.find((s) => s.name === "check_claims" && s.attributes["company.id"] === id);

    expect(assessFor(1001).attributes).toMatchObject({
      "guardrail.ok": false,
      "guardrail.error_count": 1,
      "guardrail.finding_codes": ["fit_score_out_of_range"],
    });
    expect(claimsFor(1001)).toBeUndefined(); // invalid assessment: no claim check
    expect(claimsFor(1003)?.attributes).toMatchObject({
      "guardrail.ok": false,
      "claims.cited_fact_ids": ["1003:website"],
      "claims.violating_fact_ids": ["1003:website"],
      "claims.outcome": "removed",
      "guardrail.finding_codes": ["non_citeable_citation"],
    });
    expect(claimsFor(1004)?.attributes).toMatchObject({ "guardrail.ok": true, "claims.outcome": "kept" });
  });

  it("never puts raw company records on a guardrail span", async () => {
    const h = harness(EVIDENCE_CONFIG);
    await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const text = spanText(flattenSpans(h.roots).filter((s) => GUARDRAILS.includes(s.name)));
    for (const company of FIXTURE_COMPANIES) {
      if (company.professional_network_url) expect(text).not.toContain(company.professional_network_url);
      if (company.website) expect(text).not.toContain(company.website);
    }
    expect(text).not.toContain("retrieved_at");
  });
});

describe("improved run metrics", () => {
  it("reports guardrail outcomes as counts and ids for the evidence run", async () => {
    const h = harness(EVIDENCE_CONFIG);
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    expect(result.metrics).toEqual({
      rejected: { count: 1, company_ids: [1010] },
      flagged: { count: 5, company_ids: [1002, 1003, 1006, 1008, 1009] },
      duplicates_removed: { count: 1, company_ids: [1005] },
      enrichment: {
        eligible: { count: 8, company_ids: [1001, 1002, 1003, 1004, 1006, 1007, 1008, 1009] },
        // Requested in priority order ("valid" first); enriched in search order.
        requested: { count: 5, company_ids: [1001, 1004, 1007, 1002, 1003] },
        enriched: { count: 5, company_ids: [1001, 1002, 1003, 1004, 1007] },
      },
      assessments_failed: { count: 0, company_ids: [], by_reason: {} },
      outreach_suppressed: { count: 0, company_ids: [] },
      claim_violations: { count: 0, drafts: 0, by_code: {}, company_ids: [] },
    });
    expect(h.roots[0].attributes).toMatchObject({
      "improved.duplicates_removed": 1,
      "improved.enrichment_eligible": 8,
      "improved.enrichment_requested": 5,
    });
  });

  it("counts failed assessments, suppressed outreach and claim violations", async () => {
    const h = harness(EVIDENCE_CONFIG, {
      llm: {
        respond: replyFor({
          1001: assessmentJson(1001, { fit_score: 150 }),
          1002: "not json",
          1003: assessmentJson(1003, {
            outreach: { body: "Congrats on 40% growth.", cited_fact_ids: ["1003:website", "9999:revenue"] },
          }),
          1004: assessmentJson(1004, { outreach: { body: "Hi.", cited_fact_ids: [] } }),
        }),
      },
    });
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    expect(result.metrics?.assessments_failed).toEqual({
      count: 2,
      company_ids: [1001, 1002],
      by_reason: { invalid_assessment: 1, malformed_output: 1 },
    });
    expect(result.metrics?.outreach_suppressed).toEqual({ count: 2, company_ids: [1003, 1004] });
    expect(result.metrics?.claim_violations).toEqual({
      count: 4,
      drafts: 2,
      by_code: { non_citeable_citation: 1, unknown_citation: 1, unsupported_number: 1, no_citations: 1 },
      company_ids: [1003, 1004],
    });
  });

  it("holds only plain JSON counts and ids, no records", async () => {
    const h = harness(EVIDENCE_CONFIG);
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const json = JSON.stringify(result.metrics);
    expect(JSON.parse(json)).toEqual(result.metrics);
    // Record fields and fact fields must not appear as keys.
    for (const field of ["professional_network_url", "primary_domain", "retrieved_at", "claim", "raw", "facts"]) {
      expect(json).not.toContain(`"${field}":`);
    }
  });

  it("is absent when the run stops before validation", async () => {
    const h = harness(EVIDENCE_CONFIG, { fixture: { failures: [{ call_number: 1, category: "rate_limited" }] } });
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    expect(result.status).toBe("stopped");
    expect(result.metrics).toBeUndefined();
  });
});

describe("agent exports", () => {
  it("export the improved pipeline, the citation helper and the shared prompt rules", () => {
    expect(typeof agent.runImprovedPipeline).toBe("function");
    expect(typeof agent.runBaselinePipeline).toBe("function");
    expect(typeof agent.computeBaselineCitationMetrics).toBe("function");
    expect(typeof agent.classifyCitations).toBe("function");
    expect(agent.PROMPT_VERSION).toBe("signalscout-prompt-v1");
    expect(agent.FACTS_SYSTEM_PROMPT).toContain(agent.PROMPT_SAFETY_RULES);
    expect(agent.BASELINE_SYSTEM_PROMPT).toContain(agent.PROMPT_SAFETY_RULES);
  });
});
