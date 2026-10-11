// Dependency contract between the two pipelines. The type assertions below
// are checked by `npx tsc --noEmit` (tests are part of the project), and the
// runtime checks by Vitest. No network: data comes from FixtureProvider and
// model output from the fake LLM.

import { describe, expect, expectTypeOf, it } from "vitest";
import { runImprovedPipeline } from "../../src/core/agent/improved-pipeline";
import { runBaselinePipeline } from "../../src/core/agent/pipeline";
import type {
  FactProvenance,
  ImprovedPipelineDeps,
  PipelineDeps,
} from "../../src/core/agent/types";
import { EVIDENCE_CONFIG, OPEN_ICP, harness } from "./helpers";

describe("dependency types", () => {
  it("lets baseline callers omit fact_provider", () => {
    // The shape scripts/run-pipeline.ts passes today.
    type RunnerDeps = Pick<PipelineDeps, "provider" | "budget" | "llm" | "tracer">;
    expectTypeOf<RunnerDeps>().toMatchTypeOf<PipelineDeps>();
    expectTypeOf<Parameters<typeof runBaselinePipeline>[1]>().toEqualTypeOf<PipelineDeps>();
  });

  it("requires fact_provider for the improved pipeline", () => {
    expectTypeOf<Parameters<typeof runImprovedPipeline>[1]>().toEqualTypeOf<ImprovedPipelineDeps>();
    expectTypeOf<ImprovedPipelineDeps["fact_provider"]>().toEqualTypeOf<FactProvenance>();
    expectTypeOf<PipelineDeps>().not.toMatchTypeOf<ImprovedPipelineDeps>();
    // One deps object with fact_provider drives both pipelines.
    expectTypeOf<ImprovedPipelineDeps>().toMatchTypeOf<PipelineDeps>();
  });

  it("keeps the same options and result types for both pipelines", () => {
    expectTypeOf<Parameters<typeof runImprovedPipeline>[2]>().toEqualTypeOf<
      Parameters<typeof runBaselinePipeline>[2]
    >();
    expectTypeOf<ReturnType<typeof runImprovedPipeline>>().toEqualTypeOf<
      ReturnType<typeof runBaselinePipeline>
    >();
  });
});

describe("runBaselinePipeline without fact_provider", () => {
  it("runs from the runner's exact dependency shape", async () => {
    const h = harness(EVIDENCE_CONFIG);
    const provider = h.fixture;
    const result = await runBaselinePipeline(
      OPEN_ICP,
      { provider, budget: provider.budget, llm: h.llm, tracer: h.deps.tracer },
      { config: EVIDENCE_CONFIG },
    );
    expect(result).toMatchObject({ pipeline: "naive_baseline", status: "completed" });
    expect(result.run.counts).toMatchObject({ searched: 10, enriched: 5, llm_calls: 10 });
  });

  it("ignores fact_provider when one is given", async () => {
    const run = async (withProvenance: boolean) => {
      const h = harness(EVIDENCE_CONFIG);
      const deps: PipelineDeps = withProvenance
        ? h.deps
        : { provider: h.deps.provider, budget: h.deps.budget, llm: h.deps.llm, trace_id: "trace-test" };
      return runBaselinePipeline(OPEN_ICP, deps, { config: EVIDENCE_CONFIG });
    };
    const [without, withIt] = await Promise.all([run(false), run(true)]);
    expect(withIt.prospects).toEqual(without.prospects);
    expect(withIt.run.counts).toEqual(without.run.counts);
    expect(withIt.prospects.every((p) => p.facts === undefined)).toBe(true);
  });
});

describe("runImprovedPipeline fact provenance", () => {
  it("refuses to run without an explicit fact_provider, before any call", async () => {
    const h = harness(EVIDENCE_CONFIG);
    const { provider, budget, llm, tracer } = h.deps;
    await expect(
      // @ts-expect-error fact_provider is required by ImprovedPipelineDeps
      runImprovedPipeline(OPEN_ICP, { provider, budget, llm, tracer }, { config: EVIDENCE_CONFIG }),
    ).rejects.toThrow(/fact_provider set to "fixture" or "crustdata"/);
    expect(h.fixture.calls_made).toBe(0);
    expect(h.llm.requests).toHaveLength(0);
    expect(h.roots).toHaveLength(0);
  });

  it("refuses an unknown provenance value from an untyped caller", async () => {
    const h = harness(EVIDENCE_CONFIG);
    const deps = { ...h.deps, fact_provider: "derived" } as unknown as ImprovedPipelineDeps;
    await expect(runImprovedPipeline(OPEN_ICP, deps, { config: EVIDENCE_CONFIG })).rejects.toThrow(TypeError);
    expect(h.fixture.calls_made).toBe(0);
  });

  it.each(["fixture", "crustdata"] as const)("labels every provider fact %s", async (fact_provider) => {
    const h = harness(EVIDENCE_CONFIG);
    const result = await runImprovedPipeline(OPEN_ICP, { ...h.deps, fact_provider }, { config: EVIDENCE_CONFIG });
    const facts = result.prospects.flatMap((p) => p.facts ?? []);
    expect(facts.length).toBeGreaterThan(0);
    // Provider facts carry the stated provenance; cross-checks stay "derived".
    expect(new Set(facts.map((f) => f.source.provider))).toEqual(new Set([fact_provider, "derived"]));
    const buildFacts = h.roots[0].children.find((s) => s.name === "build_facts");
    expect(buildFacts?.attributes["facts.provider"]).toBe(fact_provider);
  });
});
