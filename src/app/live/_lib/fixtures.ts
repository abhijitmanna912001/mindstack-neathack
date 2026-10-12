// Synthetic fixtures for the live-page preview. SYNTHETIC: the success
// response is the same synthetic run a synthetic-mode code gets from the
// server (runSyntheticPipeline: fixture companies, FixtureProvider and the
// guardrail-demo fake model), mapped with toLiveResultsDto in synthetic mode.
// They are not live results, do not represent any live or real-model
// evaluation, and never depend on the ICP the user enters. Built on the
// server only; the browser receives the resulting DTOs.

import { FakeLlmClient } from "../../../core/agent/fake-llm";
import { runImprovedPipeline } from "../../../core/agent/improved-pipeline";
import type { PipelineResult } from "../../../core/agent/types";
import { FixtureProvider } from "../../../core/data/fixture-provider";
import { guardrailDemoResponder } from "../../results/_lib/guardrail-demo";
import {
  SIMULATED_COST_PER_RECORD,
  SYNTHETIC_FACT_PROVIDER,
  SYNTHETIC_ICP,
  SYNTHETIC_RUN_CONFIG,
  SYNTHETIC_TRACE_LABEL,
} from "../../results/_lib/synthetic-config";
import { runSyntheticPipeline } from "../../results/_lib/synthetic-run";
import { type LiveRunSuccess, SYNTHETIC_NOTICES } from "./contract";
import { toLiveResultsDto } from "./live-results";
import type { PreviewFixtures } from "./preview";

// The model name the server reports for synthetic runs.
export const SYNTHETIC_MODEL_NAME = "fake";

// A made-up allowance shown in the preview. Synthetic.
export const PREVIEW_RUNS_REMAINING = 2;

// The partial fixture stops after this many model calls, so some eligible
// companies are left unassessed (the pipeline reports llm_call_cap_reached).
export const PARTIAL_MODEL_CALL_CAP = 2;

export const PREVIEW_NOTICE =
  "Synthetic preview response, generated from fixtures for the frontend preview. It is not a live result.";

export const PARTIAL_PREVIEW_NOTICE =
  "Simulated partial response: this fixture run was stopped at a lower model-call limit, so some companies were not assessed.";

async function syntheticRun(): Promise<PipelineResult> {
  const run = await runSyntheticPipeline("synthetic");
  if (run.kind !== "ok") throw new Error("The synthetic preview run was rejected.");
  return run.result;
}

// The same synthetic run with a lower model-call cap, for the partial state.
async function cappedSyntheticRun(): Promise<PipelineResult> {
  const config = { ...SYNTHETIC_RUN_CONFIG, max_llm_calls_per_run: PARTIAL_MODEL_CALL_CAP };
  const provider = new FixtureProvider({ config, cost_per_record: SIMULATED_COST_PER_RECORD });
  return runImprovedPipeline(
    SYNTHETIC_ICP,
    {
      provider,
      budget: provider.budget,
      llm: new FakeLlmClient({ respond: guardrailDemoResponder }),
      fact_provider: SYNTHETIC_FACT_PROVIDER,
      trace_id: SYNTHETIC_TRACE_LABEL,
    },
    { config },
  );
}

function asResponse(result: PipelineResult, extraNotices: readonly string[] = []): LiveRunSuccess {
  return {
    status: "ok",
    mode: "synthetic",
    results: toLiveResultsDto(result, { mode: "synthetic", model: SYNTHETIC_MODEL_NAME }),
    usage: { runsRemaining: PREVIEW_RUNS_REMAINING },
    notices: [...SYNTHETIC_NOTICES, PREVIEW_NOTICE, ...extraNotices],
  };
}

export async function buildPreviewFixtures(): Promise<PreviewFixtures> {
  const [success, partial] = await Promise.all([syntheticRun(), cappedSyntheticRun()]);
  return {
    success: asResponse(success),
    partial: asResponse(partial, [PARTIAL_PREVIEW_NOTICE]),
  };
}
