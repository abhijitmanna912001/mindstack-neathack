// Official entry point for evidence runs of the SignalScout pipelines.
//
//   npx tsx scripts/run-pipeline.ts --pipeline baseline
//   npx tsx scripts/run-pipeline.ts --pipeline improved --llm real --confirm-spend
//   npx tsx scripts/run-pipeline.ts --pipeline improved --provider crustdata --confirm-spend
//
// Options: --pipeline baseline|improved, --llm fake|real (default fake),
// --provider fixture|crustdata (default fixture), --confirm-spend (required
// with --llm real or --provider crustdata), --label <string> (default:
// pipeline name), --config dev|eval (default eval), --trace on|off (fixture
// only; crustdata runs are never traced), and for crustdata runs --industry
// (default "Staffing and Recruiting"), --country (default "India") and
// --sizes (default "11-50,51-200"). CRUSTDATA_API_KEY must be set for crustdata.
//
// Writes runs/<timestamp>-<label>.json with counts, ids, costs, issue codes,
// tokens and timings only: no company records, keys or headers.

import { mkdir, writeFile } from "node:fs/promises";
import {
  FakeLlmClient,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type PipelineResult,
  PROMPT_SAFETY_RULES,
  PROMPT_VERSION,
  type PipelineTracer,
  computeBaselineCitationMetrics,
  describeIcp,
  noopTracer,
  runBaselinePipeline,
  runImprovedPipeline,
} from "../src/core/agent";
import { createGatewayLlmClient } from "../src/core/agent/gateway-client";
import { CrustdataProvider } from "../src/core/data/crustdata-provider";
import { FixtureProvider } from "../src/core/data/fixture-provider";
import { BudgetGuard, type CompanyProvider } from "../src/core/data/provider";
import { validateCompanies } from "../src/core/data/validation";
import {
  DEFAULT_RUN_CONFIG,
  DEV_RUN_CONFIG,
  type RawCompany,
  type RunConfig,
} from "../src/core/types";
import {
  type PostHocValidation,
  type ResolvedRun,
  buildRunIcp,
  exitCodeForError,
  exitCodeForStatus,
  parseRunArgs,
  recordSystemHashes,
  sha256Hex,
  summarizeValidation,
  UsageError,
  validateRunArgs,
} from "./run-metrics";

// What the evidence ICP means in words; matches describeIcp for the open ICP.
const EVIDENCE_ICP_DESCRIPTION = "Companies in any industry of any size in any location.";

// Simulated at measured Crustdata prices (USD per record).
const SIMULATED_COST_PER_RECORD = { search: 0.069, enrich: 0.6 } as const;

const EVAL_RUN_CONFIG: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  max_search_results: 10,
  max_enrichments: 5,
};

// Both pipelines see the same records: Crustdata's default order is not stable
// between calls, so crustdata runs sort by company id.
const CRUSTDATA_SEARCH_SORT = { field: "crustdata_company_id", order: "asc" } as const;

type Args = ResolvedRun;

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

// Delegates to the real or fake client and records only the hashes of the
// system messages it is asked to send, never their text.
class HashingLlmClient implements LlmClient {
  readonly system_hashes = new Set<string>();

  constructor(private readonly inner: LlmClient) {}

  get records_llm_spans(): boolean {
    return this.inner.records_llm_spans;
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    recordSystemHashes(request.messages, this.system_hashes);
    return this.inner.complete(request);
  }
}

function postHocValidation(searched: readonly RawCompany[], result: PipelineResult): PostHocValidation {
  // The pipeline returns one prospect per searched company, in search order.
  return summarizeValidation(
    validateCompanies(searched),
    result.prospects.map((p) => ({
      company_id: p.raw.crustdata_company_id,
      enriched: p.enrichment.status === "enriched",
      delivered: p.assessment.status === "assessed",
    })),
  );
}

interface ProviderSpend {
  search: number;
  enrich: number;
}

function buildReport(
  args: Args,
  config: RunConfig,
  icp_description: string,
  result: PipelineResult,
  started_at: string,
  prompt: { readonly system_prompt_hashes: readonly string[] },
  validation: PostHocValidation,
  spend: ProviderSpend,
) {
  const { run, usage } = result;
  const fact_provider = args.provider;
  const simulated = args.provider === "fixture";
  return {
    started_at,
    label: args.label,
    pipeline: args.pipeline,
    provider: args.provider,
    fact_provider,
    tracing: args.tracing ? "on" : "off",
    search_sort: simulated ? null : CRUSTDATA_SEARCH_SORT,
    icp_description,
    // ICP parameters from the flags; no company data.
    icp_flags: simulated ? null : { industry: args.industry, country: args.country, sizes: args.sizes },
    config_name: args.config,
    config,
    trace_id: run.trace_id,
    status: result.status,
    counts: run.counts,
    cost_usd_by_step: run.cost_usd_by_step,
    timings_ms_by_step: run.timings_ms_by_step,
    cost_basis: {
      provider: simulated ? "simulated" : "measured",
      ...(simulated && { provider_cost_per_record_usd: SIMULATED_COST_PER_RECORD }),
      provider_cost_usd: { search: spend.search, enrich: spend.enrich, total: spend.search + spend.enrich },
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
    prompt_provenance: {
      prompt_version: PROMPT_VERSION,
      prompt_safety_rules_sha256: sha256Hex(PROMPT_SAFETY_RULES),
      system_prompt_hashes: prompt.system_prompt_hashes,
    },
    post_hoc_validation: validation,
    // Baseline: citations measured after the fact. Improved: its own guardrail
    // counts (null when it stopped before validation). Counts and ids only.
    citation_metrics: args.pipeline === "baseline" ? computeBaselineCitationMetrics(result, fact_provider) : null,
    improved_metrics: args.pipeline === "improved" ? (result.metrics ?? null) : null,
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

function buildProvider(args: Args, config: RunConfig): CompanyProvider & { readonly budget: BudgetGuard } {
  if (args.provider === "fixture") {
    return new FixtureProvider({ config, cost_per_record: SIMULATED_COST_PER_RECORD });
  }
  // Presence was checked by validateRunArgs before anything was built.
  return new CrustdataProvider({
    api_key: process.env.CRUSTDATA_API_KEY ?? "",
    budget: new BudgetGuard(config),
    search_sort: CRUSTDATA_SEARCH_SORT,
  });
}

// Tracing is loaded lazily so a crustdata or --trace off run never imports or
// initialises neatlogs.
async function withTracing<T>(
  args: Args,
  fn: (tracer: PipelineTracer) => Promise<T>,
): Promise<T> {
  if (!args.tracing) return fn(noopTracer);
  const { span } = await import("neatlogs");
  const { neatlogsTracer } = await import("../src/core/agent/neatlogs-tracer");
  const { closeTracing, initTracing } = await import("../src/core/observability/tracing");
  await initTracing({ run_label: args.label });
  try {
    return await span({ kind: "WORKFLOW", name: "signalscout_run" }, () => fn(neatlogsTracer))();
  } finally {
    await closeTracing();
  }
}

async function main(): Promise<void> {
  const args = validateRunArgs(parseRunArgs(process.argv.slice(2)), process.env);
  const config = args.config === "dev" ? DEV_RUN_CONFIG : EVAL_RUN_CONFIG;
  const icp = buildRunIcp(args);
  const icp_description =
    args.provider === "fixture" ? EVIDENCE_ICP_DESCRIPTION : describeIcp(icp);

  const provider = buildProvider(args, config);
  const llm = new HashingLlmClient(buildLlm(args.llm));
  const searched: RawCompany[] = [];
  const spend: ProviderSpend = { search: 0, enrich: 0 };
  const recordingProvider: CompanyProvider = {
    autocompleteIndustry: (query) => provider.autocompleteIndustry(query),
    async enrichCompanies(urls) {
      const res = await provider.enrichCompanies(urls);
      if (res.ok) spend.enrich += res.cost_usd;
      return res;
    },
    async searchCompanies(filters, limit) {
      const res = await provider.searchCompanies(filters, limit);
      if (res.ok) {
        searched.push(...res.data);
        spend.search += res.cost_usd;
      }
      return res;
    },
  };
  const started_at = new Date().toISOString();

  const result = await withTracing(args, (tracer) => {
    const deps = { provider: recordingProvider, budget: provider.budget, llm, tracer };
    return args.pipeline === "baseline"
      ? runBaselinePipeline(icp, deps, { config })
      : runImprovedPipeline(icp, { ...deps, fact_provider: args.provider }, { config });
  });

  const system_prompt_hashes = [...llm.system_hashes].sort();
  const validation = postHocValidation(searched, result);
  const report = buildReport(args, config, icp_description, result, started_at, { system_prompt_hashes }, validation, spend);
  await mkdir("runs", { recursive: true });
  const path = `runs/${started_at.replace(/[:.]/g, "-")}-${fileSafe(args.label)}.json`;
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);

  const { counts, cost_usd_by_step: cost } = result.run;
  const llmCost = result.usage.llm_cost;
  const costBasis = args.provider === "fixture" ? "simulated at measured Crustdata prices" : "measured";
  console.log(`run ${result.run.trace_id}  status=${result.status}  label=${args.label}`);
  console.log(
    `setup    pipeline=${args.pipeline} provider=${args.provider} fact_provider=${args.provider} tracing=${args.tracing ? "on" : "off"}` +
      ` search_sort=${args.provider === "fixture" ? "none" : `${CRUSTDATA_SEARCH_SORT.field} ${CRUSTDATA_SEARCH_SORT.order}`}`,
  );
  console.log(
    `counts   searched=${counts.searched} enriched=${counts.enriched} delivered=${counts.delivered} llm_calls=${counts.llm_calls}`,
  );
  console.log(`tokens   in=${counts.llm_input_tokens} out=${counts.llm_output_tokens}  (${tokenBasis(args.llm)})`);
  console.log(
    `provider search=$${cost.search.toFixed(3)} enrich=$${cost.enrich.toFixed(3)}  (${costBasis}; provider-returned total=$${(spend.search + spend.enrich).toFixed(3)})`,
  );
  console.log(
    `llm      gateway_reported=$${llmCost.gateway_reported_usd.toFixed(4)} (${llmCost.calls_by_basis.gateway_reported} calls)` +
      `  estimated=$${llmCost.estimated_usd.toFixed(4)} (${llmCost.calls_by_basis.estimated} calls)` +
      `  unavailable=${llmCost.calls_by_basis.unavailable} calls`,
  );
  console.log(
    `prompt   version=${PROMPT_VERSION} safety_rules_sha256=${sha256Hex(PROMPT_SAFETY_RULES).slice(0, 12)} system_hashes=${system_prompt_hashes.join(",") || "none"}`,
  );
  const fmt = (c: { valid: number; flagged: number; rejected: number }) =>
    `valid=${c.valid} flagged=${c.flagged} rejected=${c.rejected}`;
  console.log("post-hoc validation (counts)");
  console.log(`  searched  ${fmt(validation.searched)}`);
  console.log(`  enriched  ${fmt(validation.enriched)}  wasted_enrichments=${validation.wasted_enrichments}`);
  console.log(`  delivered ${fmt(validation.delivered)}  duplicate_groups=${validation.delivered_duplicate_groups}`);
  if (args.pipeline === "baseline") {
    const m = computeBaselineCitationMetrics(result, args.provider);
    console.log(
      `citations assessed=${m.assessed} drafts=${m.outreach_drafts} cited=${m.cited_fact_ids} citeable=${m.citeable} missing=${m.missing}` +
        ` cross_company=${m.cross_company} model_provider=${m.model_provider} uncertain=${m.uncertain}` +
        ` other_non_citeable=${m.other_non_citeable} drafts_with_violations=${m.drafts_with_violations.count}`,
    );
  } else if (result.metrics) {
    const m = result.metrics;
    console.log(
      `improved rejected=${m.rejected.count} flagged=${m.flagged.count} duplicates_removed=${m.duplicates_removed.count}` +
        ` eligible=${m.enrichment.eligible.count} requested=${m.enrichment.requested.count} enriched=${m.enrichment.enriched.count}` +
        ` assessments_failed=${m.assessments_failed.count} outreach_suppressed=${m.outreach_suppressed.count}` +
        ` claim_violations=${m.claim_violations.count} (drafts=${m.claim_violations.drafts})`,
    );
  } else {
    console.log("improved metrics unavailable (the run stopped before validation)");
  }
  console.log(`issues   ${result.issues.map((i) => i.code).join(", ") || "none"}`);
  console.log(`report   ${path}`);
  if (result.status === "stopped") {
    console.error("The run stopped early; see the issue codes above.");
  }
  process.exitCode = exitCodeForStatus(result.status);
}

main().catch((err) => {
  console.error(
    err instanceof UsageError ? err.message : `Run failed: ${err instanceof Error ? err.message : "unknown error"}`,
  );
  process.exitCode = exitCodeForError(err);
});
