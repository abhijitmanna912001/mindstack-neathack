// Local check of the live-mode model configuration. Makes real, small paid
// model calls on the fixture companies (no Crustdata, no tracer, no files).
//
//   LIVE_LLM_API_KEY=... LIVE_LLM_BASE_URL=... LIVE_LLM_MODEL=... \
//     npx tsx scripts/check-live-model.ts --confirm-spend
//
// Prints counts, codes, token totals, cost fields and elapsed time only: never
// prompts, model text, company names, keys, the base URL or provider messages.
// Exit codes: 0 ok, 1 configuration invalid or run failed, 2 usage.

import { runImprovedPipeline } from "../src/core/agent/improved-pipeline";
import type { LlmClient, LlmRequest, LlmResponse } from "../src/core/agent/llm";
import { FixtureProvider } from "../src/core/data/fixture-provider";
import { modelCost } from "../src/app/live/_lib/live-results";
import { LIVE_RUN_CONFIG } from "../src/server/live/run-live";
import type { RunConfig } from "../src/core/types";

// Same pattern as src/server/live/config.ts.
const MODEL_NAME = /^[A-Za-z0-9._:/-]{1,64}$/;

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Reports a failed call with fixed text only. The client returns errors rather
// than throwing; a thrown error is reported by class name.
class SafeReportingClient implements LlmClient {
  constructor(private readonly inner: LlmClient) {}

  get records_llm_spans(): boolean {
    return this.inner.records_llm_spans;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    try {
      const res = await this.inner.complete(request);
      if (!res.ok) console.log(`model call failed (${res.error.category})`);
      return res;
    } catch (err) {
      console.log(`model call failed (${err instanceof Error ? err.constructor.name : "unknown"})`);
      throw err;
    }
  }
}

async function main(): Promise<number> {
  if (process.argv[2] !== "--confirm-spend") {
    console.error("This makes real paid model calls. Re-run with --confirm-spend as the first argument.");
    return 2;
  }

  const apiKey = process.env.LIVE_LLM_API_KEY;
  const baseURL = process.env.LIVE_LLM_BASE_URL;
  const model = process.env.LIVE_LLM_MODEL;
  const bad: string[] = [];
  if (!present(apiKey)) bad.push("LIVE_LLM_API_KEY");
  if (!present(baseURL)) bad.push("LIVE_LLM_BASE_URL");
  if (!present(model) || !MODEL_NAME.test(model)) bad.push("LIVE_LLM_MODEL");
  if (!present(apiKey) || !present(baseURL) || !present(model) || bad.length > 0) {
    console.error(`Missing or invalid: ${bad.join(", ")}`);
    return 1;
  }

  const { createGatewayLlmClient } = await import("../src/core/agent/gateway-client");
  const llm = new SafeReportingClient(createGatewayLlmClient({ apiKey, baseURL }));

  const config: RunConfig = { ...LIVE_RUN_CONFIG, model };
  const provider = new FixtureProvider({ config });
  const icp = {
    industry: "",
    employee_count_ranges: [],
    locations: [],
    keywords: [],
    excluded_domains: [],
  };

  const started = Date.now();
  const result = await runImprovedPipeline(
    icp,
    { provider, budget: provider.budget, llm, fact_provider: "fixture" },
    { config },
  );
  const elapsed = (Date.now() - started) / 1000;

  let assessed = 0;
  let failed = 0;
  let notAssessed = 0;
  const reasons: Record<string, number> = {};
  for (const p of result.prospects) {
    const a = p.assessment;
    if (a.status === "assessed") assessed++;
    else if (a.status === "failed") {
      failed++;
      reasons[a.reason] = (reasons[a.reason] ?? 0) + 1;
    } else notAssessed++;
  }

  const { counts } = result.run;
  const cost = result.usage.llm_cost;
  const mc = modelCost(cost, counts.llm_calls);
  const reasonText =
    Object.entries(reasons)
      .map(([code, n]) => `${code}=${n}`)
      .join(",") || "none";
  const by = cost.calls_by_basis;

  console.log(`status: ${result.status}`);
  console.log(`prospects: assessed=${assessed} failed=${failed} not_assessed=${notAssessed}`);
  console.log(`failed_reasons: ${reasonText}`);
  console.log(`model_calls: ${counts.llm_calls}`);
  console.log(`tokens: input=${counts.llm_input_tokens} output=${counts.llm_output_tokens}`);
  console.log(
    `llm_cost: known_usd=${cost.known_usd} complete=${cost.complete}` +
      ` calls_by_basis=gateway_reported:${by.gateway_reported},estimated:${by.estimated},unavailable:${by.unavailable}`,
  );
  console.log(
    `model_cost: model_basis=${mc.model_basis} model_complete=${mc.model_complete} model_calls_unavailable=${mc.model_calls_unavailable}`,
  );
  console.log(`elapsed_seconds: ${elapsed.toFixed(1)}`);
  return result.status === "stopped" ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`Check failed (${err instanceof Error ? err.constructor.name : "unknown"})`);
    process.exitCode = 1;
  },
);
