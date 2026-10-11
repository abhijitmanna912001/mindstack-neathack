import { describe, expect, it } from "vitest";
import { defaultFakeAssessment } from "../../src/core/agent/fake-llm";
import type { LlmClient } from "../../src/core/agent/llm";
import { estimateCostUsd } from "../../src/core/agent/llm-cost";
import { LLM_TEMPERATURE } from "../../src/core/agent/llm-policy";
import { runBaselinePipeline } from "../../src/core/agent/pipeline";
import type { BaselineProspect } from "../../src/core/agent/types";
import { DEV_RUN_CONFIG, type RunConfig } from "../../src/core/types";
import { OPEN_ICP, flattenSpans, harness, icp } from "./helpers";

const ids = (prospects: readonly BaselineProspect[]) =>
  prospects.map((p) => p.raw.crustdata_company_id);

const enrichmentStatuses = (prospects: readonly BaselineProspect[]) =>
  Object.fromEntries(prospects.map((p) => [p.raw.crustdata_company_id, p.enrichment.status]));

const config = (overrides: Partial<RunConfig> = {}): RunConfig => ({
  ...DEV_RUN_CONFIG,
  ...overrides,
});

describe("runBaselinePipeline: successful run", () => {
  it("searches, enriches in search order within DEV limits, and assesses every company", async () => {
    const h = harness(config({ model: "model-from-run-config" }), { fixture: { cost_usd: 0.25 } });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, {
      config: config({ model: "model-from-run-config" }),
    });

    expect(result.status).toBe("completed");
    expect(ids(result.prospects)).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010]);

    // DEV_RUN_CONFIG allows 2 enrichments: the first two companies with a LinkedIn URL.
    expect(h.provider.enrichCalls).toHaveLength(1);
    expect(h.provider.enrichCalls[0]).toHaveLength(DEV_RUN_CONFIG.max_enrichments);
    expect(enrichmentStatuses(result.prospects)).toEqual({
      1001: "enriched",
      1002: "enriched",
      1003: "skipped_budget",
      1004: "skipped_budget",
      1005: "skipped_budget",
      1006: "skipped_budget",
      1007: "skipped_budget",
      1008: "skipped_budget",
      1009: "skipped_budget",
      1010: "skipped_no_linkedin",
    });
    // Enriched records replace their search records.
    expect(result.prospects[0].raw.source).toBe("enrich");
    expect(result.prospects[2].raw.source).toBe("search");

    // Outreach drafts come back as part of each assessment.
    for (const p of result.prospects) {
      expect(p.assessment.status).toBe("assessed");
      if (p.assessment.status === "assessed") {
        expect(p.assessment.assessment.outreach?.body).toContain(String(p.raw.crustdata_company_id));
      }
    }

    expect(result.run).toMatchObject({
      trace_id: "trace-test",
      counts: {
        searched: 10,
        enriched: 2,
        delivered: 10,
        llm_calls: 10,
        llm_input_tokens: 1000,
        llm_output_tokens: 500,
      },
      cost_usd_by_step: { plan: 0, search: 0.25, validate: 0, enrich: 0.25 },
    });
    // Fake calls report 100/50 tokens and no gateway cost, so each is estimated.
    expect(result.run.cost_usd_by_step.assess).toBeCloseTo(10 * estimateCostUsd({ prompt_tokens: 100, completion_tokens: 50 }), 12);
    expect(result.usage.llm_cost).toMatchObject({
      gateway_reported_usd: 0,
      calls_by_basis: { gateway_reported: 0, estimated: 10, unavailable: 0 },
      complete: true,
    });
    expect(result.usage.llm_http_attempts).toBe(10);
    expect(result.run.timings_ms_by_step.validate).toBe(0);
    expect(result.run.timings_ms_by_step.assess).toBeGreaterThan(0);
    expect(result.usage.provider).toEqual({ cost_usd: 0.5, searched: 10, enriched: 2 });
    expect(result.issues).toEqual([]);
  });

  it("reads the model and output-token limit from RunConfig", async () => {
    const runConfig = config({ model: "gateway/some-model", max_output_tokens_per_call: 321 });
    const h = harness(runConfig);
    await runBaselinePipeline(OPEN_ICP, h.deps, { config: runConfig });

    expect(h.llm.requests).toHaveLength(10);
    for (const request of h.llm.requests) {
      expect(request.model).toBe("gateway/some-model");
      expect(request.max_output_tokens).toBe(321);
    }
  });

  it("never runs model calls in parallel", async () => {
    const h = harness(config(), { llm: { delay_ms: 2 } });
    await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });
    expect(h.llm.requests).toHaveLength(10);
    expect(h.llm.max_in_flight).toBe(1);
  });

  it("can limit assessment to enriched companies", async () => {
    const h = harness(config());
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, {
      config: config(),
      assess: "enriched_only",
    });
    expect(h.llm.requests).toHaveLength(2);
    expect(result.prospects.filter((p) => p.assessment.status === "not_assessed")).toHaveLength(8);
  });

  it("emits a span tree through the tracer", async () => {
    const h = harness(config());
    await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

    expect(h.roots).toHaveLength(1);
    const root = h.roots[0];
    expect(root.name).toBe("signalscout_baseline_run");
    expect(root.kind).toBe("WORKFLOW");
    expect(root.attributes).toMatchObject({
      "signalscout.trace_id": "trace-test",
      "signalscout.status": "completed",
      "signalscout.llm_calls": 10,
    });
    expect(root.children.map((s) => s.name)).toEqual(["plan", "search", "enrich", "assess"]);
    // The pipeline never records an LLM span itself; per-company work is CHAIN.
    const spans = flattenSpans(h.roots);
    expect(spans.filter((s) => s.kind === "LLM")).toHaveLength(0);
    const companySpans = spans.filter((s) => s.name === "assess_company");
    expect(companySpans).toHaveLength(10);
    expect(companySpans.every((s) => s.kind === "CHAIN")).toBe(true);
    expect(companySpans[0].attributes["llm.model"]).toBe(DEV_RUN_CONFIG.model);
  });
});

describe("runBaselinePipeline: ICP to SearchFilters", () => {
  it("maps free-text industry to provider labels with autocomplete", async () => {
    const h = harness(config());
    const result = await runBaselinePipeline(icp({ industry: "soft" }), h.deps, { config: config() });

    expect(h.provider.autocompleteCalls).toEqual(["soft"]);
    expect(result.filters.industries).toEqual(["Software"]);
    expect(ids(result.prospects)).toEqual([1001]);
  });

  it("searches the raw text when autocomplete finds nothing, and ends empty without model calls", async () => {
    const h = harness(config());
    const result = await runBaselinePipeline(icp({ industry: "Fintech" }), h.deps, { config: config() });

    expect(result.filters.industries).toEqual(["Fintech"]);
    expect(result.status).toBe("completed_empty");
    expect(result.issues.map((i) => i.code)).toEqual(["industry_not_recognised", "search_no_match"]);
    expect(h.llm.requests).toHaveLength(0);
    expect(h.provider.enrichCalls).toHaveLength(0);
  });

  it("passes size ranges through and searches only the first location", async () => {
    const h = harness(config());
    const result = await runBaselinePipeline(
      icp({ employee_count_ranges: ["11-50"], locations: ["United Kingdom", "Germany"] }),
      h.deps,
      { config: config() },
    );

    expect(result.filters).toEqual({
      country: "United Kingdom",
      industries: [],
      employee_count_ranges: ["11-50"],
    });
    expect(result.issues.map((i) => i.code)).toContain("extra_locations_ignored");
    // Fixtures without a location pass any country filter.
    expect(ids(result.prospects)).toEqual([1002, 1004, 1005, 1008]);
  });
});

describe("runBaselinePipeline: budget limits", () => {
  it("makes no enrich call when the enrichment budget is zero", async () => {
    const h = harness(config({ max_enrichments: 0 }));
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, {
      config: config({ max_enrichments: 0 }),
    });

    expect(h.provider.enrichCalls).toHaveLength(0);
    expect(result.issues.map((i) => i.code)).toContain("enrich_budget_exhausted");
    expect(result.run.counts.enriched).toBe(0);
    expect(result.status).toBe("completed");
  });

  it("survives budget_cap_reached from the provider and assesses search data instead", async () => {
    // The provider's guard allows 1 enrichment; the pipeline config asks for 3.
    const h = harness(config({ max_enrichments: 3 }), {
      providerConfig: { max_search_results: 10, max_enrichments: 1 },
    });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, {
      config: config({ max_enrichments: 3 }),
    });

    expect(h.provider.enrichCalls[0]).toHaveLength(3);
    expect(result.status).toBe("completed");
    expect(result.prospects.slice(0, 3).map((p) => p.enrichment)).toEqual([
      { status: "skipped_budget", error_category: "budget_cap_reached" },
      { status: "skipped_budget", error_category: "budget_cap_reached" },
      { status: "skipped_budget", error_category: "budget_cap_reached" },
    ]);
    expect(result.issues.map((i) => i.code)).toContain("enrich_budget_exhausted");
    expect(result.usage.provider.enriched).toBe(0);
    expect(h.llm.requests).toHaveLength(10);
  });

  it("stops when the provider refuses the search for budget", async () => {
    const h = harness(config(), { providerConfig: { max_search_results: 5, max_enrichments: 2 } });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

    expect(result.status).toBe("stopped");
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "search_budget_exhausted", error_category: "budget_cap_reached" }),
    ]);
    expect(result.prospects).toEqual([]);
    expect(h.llm.requests).toHaveLength(0);
  });

  it("stops assessing at max_llm_calls_per_run", async () => {
    const runConfig = config({ max_llm_calls_per_run: 3 });
    const h = harness(runConfig);
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: runConfig });

    expect(h.llm.requests).toHaveLength(3);
    expect(result.run.counts.llm_calls).toBe(3);
    expect(result.prospects.map((p) => p.assessment.status)).toEqual([
      "assessed",
      "assessed",
      "assessed",
      ...Array(7).fill("not_assessed"),
    ]);
    expect(result.prospects[9].assessment).toEqual({ status: "not_assessed", reason: "llm_call_cap" });
    expect(result.issues.map((i) => i.code)).toContain("llm_call_cap_reached");
  });
});

describe("runBaselinePipeline: partial enrichment", () => {
  it("marks companies missing from the enrich response as not_returned", async () => {
    const h = harness(config(), {
      spy: {
        enrichResult: (r) =>
          r.ok ? { ...r, data: r.data.filter((c) => c.crustdata_company_id !== 1002) } : r,
      },
    });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

    expect(result.prospects[0].enrichment.status).toBe("enriched");
    expect(result.prospects[1].enrichment.status).toBe("not_returned");
    expect(result.prospects[1].raw.source).toBe("search");
    expect(result.run.counts.enriched).toBe(1);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "enrich_partial", step: "enrich" }),
    ]);
  });

  it("treats a no_match enrich response as nothing returned", async () => {
    const h = harness(config(), {
      spy: {
        enrichResult: () => ({ ok: false, error: { category: "no_match", message: "none" } }),
      },
    });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

    expect(result.prospects.slice(0, 2).map((p) => p.enrichment.status)).toEqual([
      "not_returned",
      "not_returned",
    ]);
    expect(result.issues.map((i) => i.code)).toEqual(["enrich_no_results"]);
    expect(result.status).toBe("completed");
  });
});

describe("runBaselinePipeline: injected provider failures", () => {
  it("stops cleanly when search fails", async () => {
    const h = harness(config(), {
      fixture: { failures: [{ call_number: 1, category: "rate_limited" }] },
    });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

    expect(result.status).toBe("stopped");
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "search_failed", error_category: "rate_limited" }),
    ]);
    expect(result.prospects).toEqual([]);
    expect(h.provider.enrichCalls).toHaveLength(0);
    expect(h.llm.requests).toHaveLength(0);
  });

  it("continues with search data when enrichment fails", async () => {
    const h = harness(config(), {
      fixture: { failures: [{ call_number: 2, category: "timeout" }] },
    });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

    expect(result.status).toBe("completed");
    expect(result.prospects.slice(0, 2).map((p) => p.enrichment)).toEqual([
      { status: "failed", error_category: "timeout" },
      { status: "failed", error_category: "timeout" },
    ]);
    expect(result.issues.map((i) => i.code)).toEqual(["enrich_failed"]);
    expect(h.llm.requests).toHaveLength(10);
  });

  it("falls back to the raw industry text when autocomplete fails", async () => {
    const h = harness(config(), {
      fixture: { failures: [{ call_number: 1, category: "auth_failed" }] },
    });
    const result = await runBaselinePipeline(icp({ industry: "Software" }), h.deps, {
      config: config(),
    });

    expect(result.issues).toEqual([
      expect.objectContaining({ code: "industry_autocomplete_failed", error_category: "auth_failed" }),
    ]);
    expect(result.filters.industries).toEqual(["Software"]);
    expect(ids(result.prospects)).toEqual([1001]);
  });
});

describe("runBaselinePipeline: model output", () => {
  it("records malformed, failed and truncated model output per company and keeps going", async () => {
    const h = harness(config(), {
      llm: {
        respond: (request, n) => {
          switch (n) {
            case 2:
              return "Sure! This company looks like a great fit.";
            case 3:
              return "```json\n" + defaultFakeAssessment(request) + "\n```";
            case 4:
              return JSON.stringify({ criterion_scores: [], uncertainty_notes: [] });
            case 5:
              return { error: "gateway timeout" };
            case 6:
              return { text: '{"fit_score": 7', truncated: true };
            case 7:
              return JSON.stringify({
                fit_score: 70,
                criterion_scores: [{ criterion: "Industry", score: "high" }],
                uncertainty_notes: [],
              });
            default:
              return defaultFakeAssessment(request);
          }
        },
      },
    });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });
    const outcome = (i: number) => result.prospects[i].assessment;

    expect(result.status).toBe("completed");
    expect(outcome(0).status).toBe("assessed");
    expect(outcome(1)).toMatchObject({ status: "failed", reason: "malformed_output" });
    expect(outcome(2).status).toBe("assessed");
    expect(outcome(3)).toMatchObject({ status: "failed", reason: "malformed_output" });
    expect(outcome(4)).toEqual({
      status: "failed",
      reason: "llm_error",
      message: "gateway timeout",
      error_category: "model_error",
    });
    expect(outcome(5)).toMatchObject({ status: "failed", reason: "truncated" });
    expect(outcome(6)).toMatchObject({ status: "failed", reason: "malformed_output" });
    expect(outcome(7).status).toBe("assessed");
    // Failed calls still count against the model-call cap.
    expect(result.run.counts.llm_calls).toBe(10);
  });

  it("contains a client that throws instead of returning an error", async () => {
    const throwing: LlmClient = {
      records_llm_spans: false,
      complete: async () => {
        throw new Error("socket hang up");
      },
    };
    const h = harness(config());
    const result = await runBaselinePipeline(OPEN_ICP, { ...h.deps, llm: throwing }, { config: config() });

    expect(result.status).toBe("completed");
    expect(result.prospects[0].assessment).toEqual({
      status: "failed",
      reason: "llm_error",
      message: "socket hang up",
      error_category: "model_error",
    });
  });
});

describe("runBaselinePipeline: model request settings", () => {
  it("sends temperature 0 on every request", async () => {
    const h = harness(config());
    await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });
    expect(h.llm.requests.map((r) => r.temperature)).toEqual(Array(10).fill(LLM_TEMPERATURE));
    expect(LLM_TEMPERATURE).toBe(0);
  });
});

describe("runBaselinePipeline: model call metadata and cost", () => {
  it("records each call on its prospect and on its span, identically", async () => {
    const h = harness(config(), {
      llm: {
        respond: (request, n) =>
          n === 1
            ? {
                text: defaultFakeAssessment(request),
                gateway_cost_usd: 0.0021,
                key_spend: { spend_usd: 3.5, max_budget_usd: 15 },
                attempts: 2,
              }
            : defaultFakeAssessment(request),
      },
    });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

    const first = result.prospects[0].llm_call;
    expect(first).toEqual({
      model: DEV_RUN_CONFIG.model,
      call_number: 1,
      attempts: 2,
      retry_waits_ms: [],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      cost: { basis: "gateway_reported", usd: 0.0021 },
      key_spend: { spend_usd: 3.5, max_budget_usd: 15 },
      header_source: "none",
    });
    expect(result.prospects[1].llm_call?.cost.basis).toBe("estimated");
    expect(result.prospects.map((p) => p.llm_call?.call_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const span = flattenSpans(h.roots).find((s) => s.name === "assess_company")!;
    expect(span.attributes).toMatchObject({
      "llm.call_number": 1,
      "llm.attempts": 2,
      "llm.cost_basis": "gateway_reported",
      "llm.cost_usd": 0.0021,
      "llm.prompt_tokens": 100,
      "llm.completion_tokens": 50,
      "llm.key_spend_usd": 3.5,
      "llm.key_max_budget_usd": 15,
    });

    expect(result.usage.llm_http_attempts).toBe(11);
    expect(result.usage.llm_cost.gateway_reported_usd).toBe(0.0021);
    expect(result.usage.llm_cost.calls_by_basis).toEqual({ gateway_reported: 1, estimated: 9, unavailable: 0 });
    expect(result.usage.llm_cost.latest_key_spend).toEqual({ spend_usd: 3.5, max_budget_usd: 15 });
    expect(result.usage.llm_cost.known_usd).toBeCloseTo(
      0.0021 + 9 * estimateCostUsd({ prompt_tokens: 100, completion_tokens: 50 }),
      12,
    );
  });

  it("never reports an unavailable cost as $0, and flags the total as incomplete", async () => {
    const h = harness(config(), {
      llm: {
        respond: (request, n) =>
          n === 3 ? { text: defaultFakeAssessment(request), usage: null } : defaultFakeAssessment(request),
      },
    });
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

    expect(result.prospects[2].llm_call?.cost).toEqual({ basis: "unavailable" });
    expect(result.prospects[2].llm_call?.usage).toBeUndefined();
    expect(result.usage.llm_cost.complete).toBe(false);
    expect(result.usage.llm_cost.calls_by_basis.unavailable).toBe(1);
    expect(result.issues.map((i) => i.code)).toContain("llm_cost_incomplete");
    const span = flattenSpans(h.roots).filter((s) => s.name === "assess_company")[2];
    expect(span.attributes["llm.cost_basis"]).toBe("unavailable");
    expect(span.attributes).not.toHaveProperty("llm.cost_usd");
    // Token totals count only calls that reported usage.
    expect(result.run.counts.llm_input_tokens).toBe(900);
  });

  it("puts each retry wait on the span as an event", async () => {
    const h = harness(config({ max_llm_calls_per_run: 1 }));
    const client: LlmClient = {
      records_llm_spans: false,
      complete: async (request) => ({
        ok: true,
        text: defaultFakeAssessment(request),
        truncated: false,
        meta: {
          model: request.model,
          attempts: 3,
          retry_waits_ms: [1000, 2000],
          cost: { basis: "unavailable" },
          header_source: "none",
        },
      }),
    };
    await runBaselinePipeline(OPEN_ICP, { ...h.deps, llm: client }, { config: config({ max_llm_calls_per_run: 1 }) });
    const span = flattenSpans(h.roots).find((s) => s.name === "assess_company")!;
    expect(span.events).toEqual([
      { name: "llm_retry", attributes: { "llm.retry": 1, "llm.retry_wait_ms": 1000 } },
      { name: "llm_retry", attributes: { "llm.retry": 2, "llm.retry_wait_ms": 2000 } },
    ]);
  });
});

describe("runBaselinePipeline: unrecoverable model errors", () => {
  it.each(["auth_failed", "rate_limited"] as const)(
    "stops making model calls after a %s error",
    async (category) => {
      const h = harness(config(), {
        llm: {
          respond: (request, n) =>
            n === 2 ? { error: `failed: ${category}`, category } : defaultFakeAssessment(request),
        },
      });
      const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });

      expect(h.llm.requests).toHaveLength(2);
      expect(result.prospects[1].assessment).toMatchObject({ status: "failed", error_category: category });
      expect(result.prospects.slice(2).every((p) => p.assessment.status === "not_assessed")).toBe(true);
      expect(result.prospects[9].assessment).toEqual({ status: "not_assessed", reason: "llm_stopped" });
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: "llm_stopped", llm_error_category: category }),
      );
      expect(result.status).toBe("completed");
    },
  );

  it("keeps going after errors that may not repeat", async () => {
    const h = harness(config(), {
      llm: {
        respond: (request, n) =>
          n === 2 ? { error: "upstream 503", category: "provider_unavailable" } : defaultFakeAssessment(request),
      },
    });
    await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });
    expect(h.llm.requests).toHaveLength(10);
  });
});

describe("runBaselinePipeline: tracing with an instrumented client", () => {
  it("does not copy the prompt or completion into its own span", async () => {
    const h = harness(config(), { llm: { records_llm_spans: true } });
    await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });
    const spans = flattenSpans(h.roots).filter((s) => s.name === "assess_company");
    expect(spans[0].input).toEqual({ company_id: 1001, enrichment_status: "enriched" });
    expect(spans.every((s) => !("llm.output" in s.attributes))).toBe(true);
  });

  it("keeps the prompt and completion when the client records no spans", async () => {
    const h = harness(config());
    await runBaselinePipeline(OPEN_ICP, h.deps, { config: config() });
    const span = flattenSpans(h.roots).find((s) => s.name === "assess_company")!;
    expect(Array.isArray(span.input)).toBe(true);
    expect(span.attributes["llm.output"]).toEqual(expect.stringContaining("fit_score"));
  });
});
