// Local verification run of the complete naive baseline: synthetic fixtures,
// FixtureProvider and the fake LLM, with DEV_RUN_CONFIG caps. Prints a run
// summary. Global fetch is stubbed to count and throw, so any attempt to
// reach a real service (Crustdata, LiteLLM, neatlogs) is measured and fails.
// This is not a neatlogs trace: tracing is never initialised and spans go to
// an in-memory recorder.
//
// What each figure is:
// - measured: counted by this test (provider and fetch calls, model
//   invocations, prospect outcomes).
// - simulated: produced by a test double (FakeLlmClient reports 1 attempt and
//   100/50 tokens per call without any HTTP; FixtureProvider charges its
//   default $0 per call).
// - estimated: model cost computed from the simulated tokens at the fallback
//   rates. Nothing is billed.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runBaselinePipeline } from "../../src/core/agent/pipeline";
import type {
  BaselineProspect,
  EnrichmentStatus,
  PipelineResult,
} from "../../src/core/agent/types";
import { DEV_RUN_CONFIG, type RunConfig } from "../../src/core/types";
import { OPEN_ICP, type Harness, flattenSpans, harness } from "./helpers";

const usd = (n: number) => `$${n.toFixed(6)}`;

const ENRICHMENT_SKIP_REASONS: Partial<Record<EnrichmentStatus, string>> = {
  skipped_budget: "enrichment cap reached",
  skipped_no_linkedin: "no LinkedIn URL to enrich by",
  not_returned: "requested but missing from the enrich response",
};

const ids = (prospects: readonly BaselineProspect[]) =>
  prospects.map((x) => x.raw.crustdata_company_id).join(", ");

// Calls to the stubbed global fetch: real network attempts, which must be 0.
let networkRequests = 0;

function summarise(label: string, config: RunConfig, result: PipelineResult, h: Harness): string {
  const p = result.prospects;
  const assessed = p.filter((x) => x.assessment.status === "assessed");
  const drafts = assessed.filter(
    (x) => x.assessment.status === "assessed" && x.assessment.assessment.outreach !== undefined,
  );
  const requested = h.provider.enrichCalls.reduce((n, urls) => n + urls.length, 0);
  const cost = result.usage.llm_cost;

  // Skips: prospects a stage passed over by design. Each is still in the result.
  const enrichSkips = Object.entries(ENRICHMENT_SKIP_REASONS).flatMap(([status, reason]) => {
    const matching = p.filter((x) => x.enrichment.status === status);
    return matching.length > 0 ? [`    enrichment ${status}: ${matching.length} (${reason}) [${ids(matching)}]`] : [];
  });
  const assessSkips = (["llm_call_cap", "not_enriched", "llm_stopped"] as const).flatMap((reason) => {
    const matching = p.filter(
      (x) => x.assessment.status === "not_assessed" && x.assessment.reason === reason,
    );
    return matching.length > 0 ? [`    assessment not_assessed/${reason}: ${matching.length} [${ids(matching)}]`] : [];
  });

  // Errors: something went wrong, not a deliberate skip.
  const enrichFailures = p.filter((x) => x.enrichment.status === "failed");
  const assessFailures = p.flatMap((x) =>
    x.assessment.status === "failed"
      ? [`    ${x.raw.crustdata_company_id} assessment failed (${x.assessment.reason}: ${x.assessment.message})`]
      : [],
  );
  const errorLines = [
    ...(enrichFailures.length > 0 ? [`    enrichment failed: ${enrichFailures.length} [${ids(enrichFailures)}]`] : []),
    ...assessFailures,
  ];

  return [
    `── Naive baseline run: ${label} ──`,
    `status: ${result.status}   trace_id: ${result.run.trace_id} (in-memory recorder, not neatlogs)`,
    `caps: search ${config.max_search_results}, enrich ${config.max_enrichments}, model calls ${config.max_llm_calls_per_run}, output tokens/call ${config.max_output_tokens_per_call}, model "${config.model}"`,
    `[measured] FixtureProvider calls: ${h.fixture.calls_made} (in memory, no network)`,
    `[measured] search: ${h.provider.searchCalls.length} call(s), limit ${h.provider.searchCalls[0]?.limit ?? "-"}, ${result.run.counts.searched} companies returned`,
    `[measured] enrich: ${h.provider.enrichCalls.length} call(s), ${requested} requested, ${result.run.counts.enriched} enriched`,
    `[measured] model: ${result.run.counts.llm_calls} logical invocation(s) of FakeLlmClient, ${assessed.length} assessed, ${drafts.length} outreach draft(s)`,
    `[simulated] model attempts reported by FakeLlmClient: ${result.usage.llm_http_attempts} (no HTTP is made)`,
    `[measured] actual network requests: ${networkRequests} (calls to the stubbed global fetch)`,
    `[simulated] provider cost (FixtureProvider default per-call cost): search ${usd(result.run.cost_usd_by_step.search)}, enrich ${usd(result.run.cost_usd_by_step.enrich)}, total ${usd(result.usage.provider.cost_usd)}`,
    `[simulated] model tokens (FakeLlmClient fixed counts): ${result.run.counts.llm_input_tokens} in / ${result.run.counts.llm_output_tokens} out`,
    `[estimated] model cost from simulated tokens at fallback rates, not billed: ${usd(cost.known_usd)}; basis ${JSON.stringify(cost.calls_by_basis)}`,
    `pipeline issues: ${result.issues.length === 0 ? "none" : result.issues.map((i) => i.code).join(", ")}`,
    `errors (${enrichFailures.length + assessFailures.length}):`,
    ...(errorLines.length > 0 ? errorLines : ["    none"]),
    `skipped (${enrichSkips.length + assessSkips.length > 0 ? "by design; skipped prospects stay in the result" : "none"}):`,
    ...enrichSkips,
    ...assessSkips,
  ].join("\n");
}

describe("naive baseline local verification (synthetic fixtures + fake LLM)", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", () => {
      networkRequests += 1;
      throw new Error("Network access is not allowed in the baseline verification run.");
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("runs the complete baseline under DEV_RUN_CONFIG and respects every cap", async () => {
    const config = DEV_RUN_CONFIG;
    const h = harness(config);
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config });
    console.log(summarise("DEV_RUN_CONFIG, open ICP", config, result, h));

    // Every stage ran.
    expect(result.status).toBe("completed");
    expect(flattenSpans(h.roots).map((s) => s.name)).toEqual(
      expect.arrayContaining(["plan", "search", "enrich", "assess", "assess_company"]),
    );

    // Search cap: one call, never asking for or receiving more than allowed.
    expect(h.provider.searchCalls).toHaveLength(1);
    expect(h.provider.searchCalls[0].limit).toBeLessThanOrEqual(config.max_search_results);
    expect(result.run.counts.searched).toBeLessThanOrEqual(config.max_search_results);

    // Enrichment cap: requested and recorded counts within the limit.
    const requested = h.provider.enrichCalls.reduce((n, urls) => n + urls.length, 0);
    expect(requested).toBeLessThanOrEqual(config.max_enrichments);
    expect(h.fixture.budget.snapshot().enriched).toBeLessThanOrEqual(config.max_enrichments);
    expect(result.run.counts.enriched).toBe(config.max_enrichments);

    // Model-call cap, sequential calls, configured request settings.
    expect(h.llm.requests.length).toBe(result.run.counts.llm_calls);
    expect(result.run.counts.llm_calls).toBeLessThanOrEqual(config.max_llm_calls_per_run);
    expect(h.llm.max_in_flight).toBe(1);
    expect(h.llm.requests.every((r) => r.model === config.model && r.temperature === 0)).toBe(true);
    expect(
      h.llm.requests.every((r) => r.max_output_tokens === config.max_output_tokens_per_call),
    ).toBe(true);

    // Invocations are logical calls to the fake; the attempt figure is the
    // fake's simulated value, and nothing reached the network.
    expect(result.usage.llm_http_attempts).toBe(result.run.counts.llm_calls);
    expect(networkRequests).toBe(0);

    // Skips are deliberate and separate from errors.
    const enrichStatuses = result.prospects.map((p) => p.enrichment.status);
    expect(enrichStatuses.filter((s) => s === "skipped_budget")).toHaveLength(7);
    expect(enrichStatuses.filter((s) => s === "skipped_no_linkedin")).toHaveLength(1);
    expect(enrichStatuses.filter((s) => s === "failed")).toHaveLength(0);
    expect(result.prospects.filter((p) => p.assessment.status === "failed")).toHaveLength(0);
    expect(result.issues).toEqual([]);

    // Assessment and outreach were produced for every company (naive: no filtering).
    expect(result.prospects).toHaveLength(result.run.counts.searched);
    expect(result.prospects.every((p) => p.assessment.status === "assessed")).toBe(true);
    expect(
      result.prospects.every(
        (p) => p.assessment.status === "assessed" && p.assessment.assessment.outreach?.body,
      ),
    ).toBe(true);
  });

  it("stops at the model-call cap when it is smaller than the result set", async () => {
    const config: RunConfig = { ...DEV_RUN_CONFIG, max_llm_calls_per_run: 4 };
    const h = harness(config);
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config });
    console.log(summarise("model-call cap 4", config, result, h));

    expect(h.llm.requests).toHaveLength(4);
    expect(result.run.counts.llm_calls).toBe(4);
    expect(result.prospects.filter((p) => p.assessment.status === "not_assessed")).toHaveLength(6);
    expect(result.issues.map((i) => i.code)).toContain("llm_call_cap_reached");
    expect(result.prospects.filter((p) => p.assessment.status === "failed")).toHaveLength(0);
    expect(networkRequests).toBe(0);
  });
});
