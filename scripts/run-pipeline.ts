// Official entry point for evidence runs of the SignalScout pipelines.
//
//   npx tsx scripts/run-pipeline.ts --pipeline baseline
//   npx tsx scripts/run-pipeline.ts --pipeline baseline --llm real --confirm-spend
//
// Options: --pipeline baseline, --llm fake|real (default fake), --confirm-spend
// (required with --llm real), --label <string> (default: pipeline name),
// --config dev|eval (default eval).
//
// Writes runs/<timestamp>-<label>.json with counts, ids, costs, issue codes,
// tokens and timings only: no company records, keys or headers.

import { mkdir, writeFile } from "node:fs/promises";
import { span } from "neatlogs";
import {
  FakeLlmClient,
  type LlmClient,
  type PipelineResult,
  runBaselinePipeline,
} from "../src/core/agent";
import { createGatewayLlmClient } from "../src/core/agent/gateway-client";
import { neatlogsTracer } from "../src/core/agent/neatlogs-tracer";
import { FixtureProvider } from "../src/core/data/fixture-provider";
import { closeTracing, initTracing } from "../src/core/observability/tracing";
import { DEFAULT_RUN_CONFIG, DEV_RUN_CONFIG, type RunConfig } from "../src/core/types";

// What the evidence ICP means in words; matches describeIcp for the open ICP.
const EVIDENCE_ICP_DESCRIPTION = "Companies in any industry of any size in any location.";

// Simulated at measured Crustdata prices (USD per record).
const SIMULATED_COST_PER_RECORD = { search: 0.069, enrich: 0.6 } as const;

const EVAL_RUN_CONFIG: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  max_search_results: 10,
  max_enrichments: 5,
};

// The ICP every evidence run uses, so runs are comparable. Open: no industry,
// size, location or keyword filter, so it matches every fixture.
const EVIDENCE_ICP = {
  industry: "",
  employee_count_ranges: [],
  locations: [],
  keywords: [],
  excluded_domains: [],
};

interface Args {
  readonly pipeline: "baseline";
  readonly llm: "fake" | "real";
  readonly confirm_spend: boolean;
  readonly label: string;
  readonly config: "dev" | "eval";
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Args {
  let pipeline: string | undefined;
  let llm = "fake";
  let confirm_spend = false;
  let label: string | undefined;
  let config = "eval";
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--pipeline":
        pipeline = value(i++, flag);
        break;
      case "--llm":
        llm = value(i++, flag);
        break;
      case "--label":
        label = value(i++, flag);
        break;
      case "--config":
        config = value(i++, flag);
        break;
      case "--confirm-spend":
        confirm_spend = true;
        break;
      default:
        throw new UsageError(`Unknown argument: ${flag}`);
    }
  }
  if (pipeline === undefined) throw new UsageError("--pipeline is required (baseline).");
  if (pipeline !== "baseline") {
    throw new UsageError(
      `Unsupported pipeline "${pipeline}". Only "baseline" exists; the improved pipeline is not built yet.`,
    );
  }
  if (llm !== "fake" && llm !== "real") throw new UsageError(`--llm must be fake or real, got "${llm}".`);
  if (config !== "dev" && config !== "eval") {
    throw new UsageError(`--config must be dev or eval, got "${config}".`);
  }
  if (llm === "real" && !confirm_spend) {
    throw new UsageError("--llm real spends money on the model gateway. Add --confirm-spend to proceed.");
  }
  const finalLabel = label ?? pipeline;
  if (finalLabel.trim() === "") throw new UsageError("--label must not be empty.");
  return { pipeline, llm, confirm_spend, label: finalLabel, config };
}

function buildLlm(kind: Args["llm"]): LlmClient {
  if (kind === "fake") return new FakeLlmClient();
  const apiKey = process.env.LITELLM_API_KEY;
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new UsageError("LITELLM_API_KEY is not set; it is required for --llm real.");
  }
  return createGatewayLlmClient({ apiKey });
}

// Fake-client token counts are made up; only real gateway usage is measured.
function tokenBasis(kind: Args["llm"]): "simulated" | "measured" {
  return kind === "fake" ? "simulated" : "measured";
}

function fileSafe(label: string): string {
  return label.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function buildReport(args: Args, config: RunConfig, result: PipelineResult, started_at: string) {
  const { run, usage } = result;
  return {
    started_at,
    label: args.label,
    pipeline: args.pipeline,
    icp_description: EVIDENCE_ICP_DESCRIPTION,
    config_name: args.config,
    config,
    trace_id: run.trace_id,
    status: result.status,
    counts: run.counts,
    cost_usd_by_step: run.cost_usd_by_step,
    timings_ms_by_step: run.timings_ms_by_step,
    cost_basis: {
      provider: "simulated",
      provider_cost_per_record_usd: SIMULATED_COST_PER_RECORD,
      llm_calls_by_basis: usage.llm_cost.calls_by_basis,
    },
    provider_usage: usage.provider,
    llm: {
      mode: args.llm,
      token_basis: tokenBasis(args.llm),
      calls: usage.llm_calls,
      http_attempts: usage.llm_http_attempts,
      input_tokens: run.counts.llm_input_tokens,
      output_tokens: run.counts.llm_output_tokens,
      gateway_reported_usd: usage.llm_cost.gateway_reported_usd,
      estimated_usd: usage.llm_cost.estimated_usd,
      known_usd: usage.llm_cost.known_usd,
      cost_complete: usage.llm_cost.complete,
    },
    issue_codes: result.issues.map((i) => i.code),
    company_ids: result.prospects.map((p) => p.raw.crustdata_company_id),
    prospects: result.prospects.map((p) => ({
      company_id: p.raw.crustdata_company_id,
      enrichment: p.enrichment.status,
      assessment: p.assessment.status,
      llm_call_number: p.llm_call?.call_number ?? null,
    })),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = args.config === "dev" ? DEV_RUN_CONFIG : EVAL_RUN_CONFIG;

  const provider = new FixtureProvider({ config, cost_per_record: SIMULATED_COST_PER_RECORD });
  const llm = buildLlm(args.llm);
  const started_at = new Date().toISOString();

  await initTracing({ run_label: args.label });
  let result: PipelineResult;
  try {
    const run = span({ kind: "WORKFLOW", name: "signalscout_run" }, () =>
      runBaselinePipeline(
        EVIDENCE_ICP,
        { provider, budget: provider.budget, llm, tracer: neatlogsTracer },
        { config },
      ),
    );
    result = await run();
  } finally {
    await closeTracing();
  }

  const report = buildReport(args, config, result, started_at);
  await mkdir("runs", { recursive: true });
  const path = `runs/${started_at.replace(/[:.]/g, "-")}-${fileSafe(args.label)}.json`;
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);

  const { counts, cost_usd_by_step: cost } = result.run;
  const llmCost = result.usage.llm_cost;
  console.log(`run ${result.run.trace_id}  status=${result.status}  label=${args.label}`);
  console.log(
    `counts   searched=${counts.searched} enriched=${counts.enriched} delivered=${counts.delivered} llm_calls=${counts.llm_calls}`,
  );
  console.log(`tokens   in=${counts.llm_input_tokens} out=${counts.llm_output_tokens}  (${tokenBasis(args.llm)})`);
  console.log(
    `provider search=$${cost.search.toFixed(3)} enrich=$${cost.enrich.toFixed(3)}  (simulated at measured Crustdata prices)`,
  );
  console.log(
    `llm      gateway_reported=$${llmCost.gateway_reported_usd.toFixed(4)} (${llmCost.calls_by_basis.gateway_reported} calls)` +
      `  estimated=$${llmCost.estimated_usd.toFixed(4)} (${llmCost.calls_by_basis.estimated} calls)` +
      `  unavailable=${llmCost.calls_by_basis.unavailable} calls`,
  );
  console.log(`issues   ${result.issues.map((i) => i.code).join(", ") || "none"}`);
  console.log(`report   ${path}`);
  if (result.status === "stopped") {
    console.error("The run stopped early; see the issue codes above.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof UsageError ? err.message : `Run failed: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exitCode = 1;
});
