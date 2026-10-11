// The results page's synthetic run: real improved pipeline, FixtureProvider
// and FakeLlmClient only. Global fetch is stubbed to throw, so any network
// attempt would fail these tests.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeLlmClient } from "../../../core/agent/fake-llm";
import { FixtureProvider } from "../../../core/data/fixture-provider";
import {
  DEMO_UNSUPPORTED_NUMBER_COMPANY_ID,
  DEMO_UNSUPPORTED_SENTENCE,
  guardrailDemoResponder,
} from "../_lib/guardrail-demo";
import {
  SIMULATED_COST_PER_RECORD,
  SYNTHETIC_FACT_PROVIDER,
  SYNTHETIC_ICP,
  SYNTHETIC_RUN_CONFIG,
} from "../_lib/synthetic-config";
import {
  loadSyntheticResults,
  runSyntheticPipeline,
  type SyntheticDependencies,
  syntheticDependencies,
} from "../_lib/synthetic-run";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

// The real dependencies, with spies to observe construction.
function spiedDependencies() {
  const created: { provider?: FixtureProvider; llm?: FakeLlmClient } = {};
  const deps: SyntheticDependencies = {
    createProvider: vi.fn(() => {
      const built = syntheticDependencies.createProvider();
      created.provider = built.provider as FixtureProvider;
      return built;
    }),
    createLlm: vi.fn(() => {
      const llm = syntheticDependencies.createLlm() as FakeLlmClient;
      created.llm = llm;
      return llm;
    }),
  };
  return { deps, created };
}

describe("synthetic configuration", () => {
  it("uses 10 searched companies and 5 enrichments", () => {
    expect(SYNTHETIC_RUN_CONFIG.max_search_results).toBe(10);
    expect(SYNTHETIC_RUN_CONFIG.max_enrichments).toBe(5);
  });

  it("labels facts exactly 'fixture'", () => {
    expect(SYNTHETIC_FACT_PROVIDER).toBe("fixture");
  });

  it("uses an ICP with no filters", () => {
    expect(SYNTHETIC_ICP).toEqual({ industry: "", employee_count_ranges: [], locations: [], keywords: [], excluded_domains: [] });
  });

  it("builds only FixtureProvider and FakeLlmClient", () => {
    const { provider, budget } = syntheticDependencies.createProvider();
    expect(provider).toBeInstanceOf(FixtureProvider);
    expect(budget).toBe((provider as FixtureProvider).budget);
    expect(syntheticDependencies.createLlm()).toBeInstanceOf(FakeLlmClient);
  });
});

describe("rejected modes", () => {
  it.each([["live"], ["crustdata"], [""], [["synthetic", "live"]], ["other"]])(
    "never construct dependencies or run the pipeline for %j",
    async (mode) => {
      const { deps } = spiedDependencies();
      const run = await runSyntheticPipeline(mode, deps);
      expect(run.kind).toBe("rejected");
      expect(deps.createProvider).not.toHaveBeenCalled();
      expect(deps.createLlm).not.toHaveBeenCalled();

      const loaded = await loadSyntheticResults(mode, deps);
      expect(loaded.kind).toBe("rejected");
      expect(deps.createProvider).not.toHaveBeenCalled();
    },
  );
});

describe("synthetic run", () => {
  it("runs the improved pipeline within 10 searched and 5 enrichments", async () => {
    const { deps, created } = spiedDependencies();
    const run = await runSyntheticPipeline(undefined, deps);
    if (run.kind !== "ok") throw new Error("expected a run");
    const { result } = run;

    expect(result.pipeline).toBe("improved");
    expect(result.status).toBe("completed");
    expect(result.usage).toMatchObject({ max_search_results: 10, max_enrichments: 5 });
    expect(result.run.counts.searched).toBeLessThanOrEqual(10);
    expect(created.provider?.budget.snapshot().enriched).toBeLessThanOrEqual(5);
    expect(result.metrics?.enrichment.requested.company_ids).toEqual([1001, 1004, 1007, 1002, 1003]);
    // Every model call went to the fake client.
    expect(created.llm?.requests.length).toBe(result.run.counts.llm_calls);
  });

  it("labels every provider fact 'fixture'", async () => {
    const run = await runSyntheticPipeline("synthetic");
    if (run.kind !== "ok") throw new Error("expected a run");
    const providers = new Set(run.result.prospects.flatMap((p) => p.facts ?? []).map((f) => f.source.provider));
    expect(providers).toEqual(new Set(["fixture", "derived"]));
  });

  it("prices the simulated provider cost from the fixture provider's per-record prices", async () => {
    const run = await runSyntheticPipeline(undefined);
    if (run.kind !== "ok") throw new Error("expected a run");
    const { searched, enriched } = run.result.run.counts;
    const expected = searched * SIMULATED_COST_PER_RECORD.search + enriched * SIMULATED_COST_PER_RECORD.enrich;
    expect(run.result.usage.provider.cost_usd).toBeCloseTo(expected, 10);
  });
});

describe("guardrail demonstration", () => {
  it("adds the unsupported figure only for the demo company", () => {
    expect(DEMO_UNSUPPORTED_SENTENCE).toMatch(/\d/);
    const prompt = (id: number) => ({
      model: "m",
      temperature: 0,
      max_output_tokens: 100,
      messages: [
        { role: "system" as const, content: "x" },
        {
          role: "user" as const,
          content: `Criteria to score (use these exact names):\n- Overall fit\n\n<company_data>\n${JSON.stringify({
            company_id: id,
            facts: [{ id: `${id}:name`, claim: "Company name is Acme", status: "given", citeable: true }],
          })}\n</company_data>`,
        },
      ],
    });
    expect(String(guardrailDemoResponder(prompt(DEMO_UNSUPPORTED_NUMBER_COMPANY_ID), 1))).toContain(DEMO_UNSUPPORTED_SENTENCE);
    expect(String(guardrailDemoResponder(prompt(1004), 1))).not.toContain(DEMO_UNSUPPORTED_SENTENCE);
  });

  it("is suppressed by the real pipeline's claim check, with its unsupported_number finding", async () => {
    const run = await runSyntheticPipeline(undefined);
    if (run.kind !== "ok") throw new Error("expected a run");
    const demo = run.result.prospects.find((p) => p.raw.crustdata_company_id === DEMO_UNSUPPORTED_NUMBER_COMPANY_ID)!;

    // The pipeline, not this app, produced the finding and dropped the outreach.
    expect(demo.checks?.outreach).toBe("removed");
    expect(demo.checks?.claims?.findings).toEqual([
      expect.objectContaining({ code: "unsupported_number", severity: "error", message: expect.stringContaining('"40"') }),
    ]);
    expect(demo.assessment.status).toBe("assessed");
    if (demo.assessment.status === "assessed") expect(demo.assessment.assessment.outreach).toBeUndefined();
    expect(run.result.metrics?.outreach_suppressed).toEqual({ count: 1, company_ids: [DEMO_UNSUPPORTED_NUMBER_COMPANY_ID] });

    // Every other assessed company keeps its default, well-behaved outreach.
    const others = run.result.prospects.filter(
      (p) => p.assessment.status === "assessed" && p.raw.crustdata_company_id !== DEMO_UNSUPPORTED_NUMBER_COMPANY_ID,
    );
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((p) => p.checks?.outreach === "kept")).toBe(true);
  });

  it("reaches the page DTO as suppressed outreach with the pipeline's finding", async () => {
    const loaded = await loadSyntheticResults(undefined);
    if (loaded.kind !== "ok") throw new Error("expected results");
    const demo = loaded.results.prospects.find((p) => p.company_id === DEMO_UNSUPPORTED_NUMBER_COMPANY_ID)!;
    expect(demo.outreach.state).toBe("suppressed");
    if (demo.outreach.state === "suppressed") {
      expect(demo.outreach.findings.map((f) => f.code)).toEqual(["unsupported_number"]);
    }
    expect(loaded.results.metrics?.outreach_suppressed.company_ids).toEqual([DEMO_UNSUPPORTED_NUMBER_COMPANY_ID]);
  });
});
