// Baseline citation metrics, measured on real baseline runs over the
// synthetic fixtures with the fake LLM. No network.

import { describe, expect, it } from "vitest";
import { classifyCitations, computeBaselineCitationMetrics } from "../../src/core/agent/citation-metrics";
import { defaultFakeAssessment } from "../../src/core/agent/fake-llm";
import type { LlmRequest } from "../../src/core/agent/llm";
import { runBaselinePipeline } from "../../src/core/agent/pipeline";
import type { BaselineProspect, PipelineResult } from "../../src/core/agent/types";
import { FIXTURE_COMPANIES } from "../../src/core/fixtures/companies";
import type { AnyFact } from "../../src/core/types";
import { EVIDENCE_CONFIG, OPEN_ICP, harness } from "./helpers";

// Company id named in a baseline (raw-record) prompt.
const companyOf = (request: LlmRequest) =>
  Number(/"crustdata_company_id":\s*(\d+)/.exec(request.messages[1].content)?.[1]);

// A baseline run where company `id` cites `cited`; everyone else uses the
// fake's default (which cites "<id>:name").
async function baselineCiting(citations: Record<number, string[]>): Promise<PipelineResult> {
  const h = harness(EVIDENCE_CONFIG, {
    llm: {
      respond: (request) => {
        const cited = citations[companyOf(request)];
        if (!cited) return defaultFakeAssessment(request);
        const parsed = JSON.parse(defaultFakeAssessment(request));
        return JSON.stringify({ ...parsed, outreach: { body: "Hello.", cited_fact_ids: cited } });
      },
    },
  });
  return runBaselinePipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
}

describe("computeBaselineCitationMetrics", () => {
  it("measures the default baseline run", async () => {
    const result = await baselineCiting({});
    const metrics = computeBaselineCitationMetrics(result, "fixture");
    // Each draft cites "<id>:name". 1002 has no name; 1005 (duplicate) and
    // 1010 are rejected, so they have no facts at all.
    expect(metrics).toEqual({
      fact_provider: "fixture",
      prospects: 10,
      assessed: 10,
      outreach_drafts: 10,
      cited_fact_ids: 10,
      citeable: 7,
      missing: 3,
      cross_company: 0,
      model_provider: 0,
      uncertain: 0,
      other_non_citeable: 0,
      drafts_with_violations: { count: 3, company_ids: [1002, 1005, 1010] },
    });
  });

  it("counts valid citations, including cross-checked facts", async () => {
    const result = await baselineCiting({ 1001: ["1001:name", "1001:latest_headcount", "1001:xcheck:website_domain"] });
    const metrics = computeBaselineCitationMetrics(result, "fixture");
    expect(metrics.cited_fact_ids).toBe(12);
    expect(metrics.citeable).toBe(9);
    expect(metrics.drafts_with_violations.company_ids).not.toContain(1001);
  });

  it("counts ids that do not exist for that company as missing", async () => {
    const result = await baselineCiting({ 1001: ["1001:funding_round"] });
    const metrics = computeBaselineCitationMetrics(result, "fixture");
    expect(metrics.missing).toBe(4);
    expect(metrics.cross_company).toBe(0);
    expect(metrics.drafts_with_violations.company_ids).toContain(1001);
  });

  it("counts another company's fact ids as missing and cross-company", async () => {
    const result = await baselineCiting({ 1001: ["1007:name"], 1003: ["1005:name"] });
    const metrics = computeBaselineCitationMetrics(result, "fixture");
    // 1007:name exists for 1007; 1005 is rejected, but its id still names it.
    expect(metrics.missing).toBe(5);
    expect(metrics.cross_company).toBe(2);
  });

  it("counts uncertain facts", async () => {
    // 1003's website is junk; 1008's size facts contradict each other.
    const result = await baselineCiting({ 1003: ["1003:website"], 1008: ["1008:latest_headcount", "1008:name"] });
    const metrics = computeBaselineCitationMetrics(result, "fixture");
    expect(metrics.uncertain).toBe(2);
    expect(metrics.drafts_with_violations.company_ids).toEqual(expect.arrayContaining([1003, 1008]));
  });

  it("labels the provenance it was given and never guesses one", async () => {
    const result = await baselineCiting({});
    expect(computeBaselineCitationMetrics(result, "crustdata").fact_provider).toBe("crustdata");
    expect(() => computeBaselineCitationMetrics(result, "derived" as never)).toThrow(TypeError);
  });

  it("returns plain JSON counts only", async () => {
    const result = await baselineCiting({});
    const metrics = computeBaselineCitationMetrics(result, "fixture");
    const json = JSON.stringify(metrics);
    expect(JSON.parse(json)).toEqual(metrics);
    expect(json).not.toContain(FIXTURE_COMPANIES[0].professional_network_url);
    expect(json).not.toContain("\"claim\":");
  });
});

describe("classifyCitations", () => {
  const prospect = (id: number, cited: string[]): BaselineProspect => ({
    raw: { ...FIXTURE_COMPANIES[0], crustdata_company_id: id },
    enrichment: { status: "enriched" },
    assessment: {
      status: "assessed",
      assessment: { fit_score: 50, criterion_scores: [], uncertainty_notes: [], outreach: { body: "Hi.", cited_fact_ids: cited } },
    },
  });
  const fact = (id: string, status: AnyFact["status"], provider: AnyFact["source"]["provider"]): AnyFact => ({
    id,
    value: "x",
    claim: "x",
    source: { provider, retrieved_at: "2026-01-15T09:00:00Z" },
    status,
  });

  it("counts model-provided facts as not citeable, even with a citeable status", () => {
    const metrics = classifyCitations(
      [prospect(1, ["1:guess", "1:name", "1:summary"])],
      [[fact("1:guess", "given", "model"), fact("1:name", "given", "fixture"), fact("1:summary", "extracted", "fixture")]],
      "fixture",
    );
    expect(metrics).toMatchObject({
      cited_fact_ids: 3,
      model_provider: 1,
      citeable: 1,
      other_non_citeable: 1,
      drafts_with_violations: { count: 1, company_ids: [1] },
    });
  });

  it("counts an id cited twice in one draft once", () => {
    const metrics = classifyCitations([prospect(1, ["1:name", "1:name"])], [[fact("1:name", "given", "fixture")]], "fixture");
    expect(metrics.cited_fact_ids).toBe(1);
  });

  it("ignores prospects that were not assessed or drafted no outreach", () => {
    const notAssessed: BaselineProspect = { ...prospect(2, []), assessment: { status: "not_assessed", reason: "llm_call_cap" } };
    const noOutreach: BaselineProspect = {
      ...prospect(3, []),
      assessment: { status: "assessed", assessment: { fit_score: 10, criterion_scores: [], uncertainty_notes: [] } },
    };
    const metrics = classifyCitations([notAssessed, noOutreach], [[], []], "fixture");
    expect(metrics).toMatchObject({ prospects: 2, assessed: 1, outreach_drafts: 0, cited_fact_ids: 0 });
  });
});
