// The results page's synthetic run: the real improved pipeline over the
// synthetic fixtures, with FixtureProvider and the deterministic FakeLlmClient
// only. No environment variables, no external calls, no tracing. The requested
// mode is checked first, before any dependency is constructed.

import { FakeLlmClient } from "../../../core/agent/fake-llm";
import { runImprovedPipeline } from "../../../core/agent/improved-pipeline";
import type { LlmClient } from "../../../core/agent/llm";
import type { PipelineResult } from "../../../core/agent/types";
import { FixtureProvider } from "../../../core/data/fixture-provider";
import type { BudgetSnapshot, CompanyProvider } from "../../../core/data/provider";
import { guardrailDemoResponder } from "./guardrail-demo";
import { parseRequestedMode } from "./mode";
import { type ResultsDto, toResultsDto } from "./presentation";
import {
  SIMULATED_COST_PER_RECORD,
  SYNTHETIC_FACT_PROVIDER,
  SYNTHETIC_ICP,
  SYNTHETIC_RUN_CONFIG,
  SYNTHETIC_TRACE_LABEL,
} from "./synthetic-config";

// Builders for the run's dependencies. Separate so tests can confirm a
// rejected mode never reaches them.
export interface SyntheticDependencies {
  createProvider(): { provider: CompanyProvider; budget: { snapshot(): BudgetSnapshot } };
  createLlm(): LlmClient;
}

export const syntheticDependencies: SyntheticDependencies = {
  createProvider() {
    const provider = new FixtureProvider({
      config: SYNTHETIC_RUN_CONFIG,
      cost_per_record: SIMULATED_COST_PER_RECORD,
    });
    return { provider, budget: provider.budget };
  },
  createLlm() {
    return new FakeLlmClient({ respond: guardrailDemoResponder });
  },
};

export type SyntheticRun =
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "ok"; readonly result: PipelineResult };

export async function runSyntheticPipeline(
  requestedMode: unknown,
  dependencies: SyntheticDependencies = syntheticDependencies,
): Promise<SyntheticRun> {
  const mode = parseRequestedMode(requestedMode);
  if (!mode.ok) return { kind: "rejected", reason: mode.reason };

  const { provider, budget } = dependencies.createProvider();
  const llm = dependencies.createLlm();
  const result = await runImprovedPipeline(
    SYNTHETIC_ICP,
    { provider, budget, llm, fact_provider: SYNTHETIC_FACT_PROVIDER, trace_id: SYNTHETIC_TRACE_LABEL },
    { config: SYNTHETIC_RUN_CONFIG },
  );
  return { kind: "ok", result };
}

export type SyntheticResults =
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "ok"; readonly results: ResultsDto };

// What the page renders: the presentation DTO, never the pipeline result.
export async function loadSyntheticResults(
  requestedMode: unknown,
  dependencies: SyntheticDependencies = syntheticDependencies,
): Promise<SyntheticResults> {
  const run = await runSyntheticPipeline(requestedMode, dependencies);
  return run.kind === "rejected" ? run : { kind: "ok", results: toResultsDto(run.result) };
}
