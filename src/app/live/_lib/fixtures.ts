// Synthetic fixtures for the live-page preview. SYNTHETIC: these come from
// the existing fixture companies, FixtureProvider and the deterministic fake
// model, run through the real improved pipeline and the shared
// toResultsDto(). They are not live results and do not represent any live or
// real-model evaluation. Built on the server only; the browser receives the
// resulting DTOs.

import { FakeLlmClient } from "../../../core/agent/fake-llm";
import { runImprovedPipeline } from "../../../core/agent/improved-pipeline";
import { FixtureProvider } from "../../../core/data/fixture-provider";
import type { RunConfig } from "../../../core/types";
import { type ResultsDto, toResultsDto } from "../../results/_lib/presentation";
import {
  SIMULATED_COST_PER_RECORD,
  SYNTHETIC_FACT_PROVIDER,
  SYNTHETIC_ICP,
  SYNTHETIC_RUN_CONFIG,
} from "../../results/_lib/synthetic-config";
import type { LiveRunSuccess } from "./contract";
import type { PreviewFixtures } from "./preview";

// A made-up allowance shown in the preview's usage panel. Synthetic.
export const PREVIEW_RUNS_REMAINING = 2;

// The partial fixture stops after this many model calls, so some eligible
// companies are left unassessed (the pipeline reports llm_call_cap_reached).
export const PARTIAL_MODEL_CALL_CAP = 2;

export const PREVIEW_NOTICE =
  "Synthetic preview response, generated from fixtures for the frontend preview. It is not a live result.";

async function syntheticResults(config: RunConfig): Promise<ResultsDto> {
  const provider = new FixtureProvider({ config, cost_per_record: SIMULATED_COST_PER_RECORD });
  const result = await runImprovedPipeline(
    SYNTHETIC_ICP,
    {
      provider,
      budget: provider.budget,
      llm: new FakeLlmClient(),
      fact_provider: SYNTHETIC_FACT_PROVIDER,
      trace_id: "live-preview-fixture",
    },
    { config },
  );
  return toResultsDto(result);
}

function asResponse(results: ResultsDto, extraNotices: readonly string[] = []): LiveRunSuccess {
  return {
    status: "ok",
    results,
    usage: {
      runsRemaining: PREVIEW_RUNS_REMAINING,
      searched: results.run.counts.searched,
      enriched: results.run.counts.enriched,
      providerCostUsd: results.run.simulated_provider_cost_usd.total,
    },
    notices: [PREVIEW_NOTICE, ...extraNotices],
  };
}

export async function buildPreviewFixtures(): Promise<PreviewFixtures> {
  const [success, partial] = await Promise.all([
    syntheticResults(SYNTHETIC_RUN_CONFIG),
    syntheticResults({ ...SYNTHETIC_RUN_CONFIG, max_llm_calls_per_run: PARTIAL_MODEL_CALL_CAP }),
  ]);
  return {
    success: asResponse(success),
    partial: asResponse(partial, [
      "Synthetic partial response: the fixture run stopped at its model-call cap, so some companies were not assessed.",
    ]),
  };
}
