// Live-mode orchestration: one request in, one typed { httpStatus, body } out.
// Order: validate, rate limit, reserve a run, check the kill switch (live
// codes only), then run in the mode the code is bound to. Fails closed. Never logs. Bodies carry fixed
// messages only: no keys, codes, upstream text, stack traces or company data.

import type { LlmClient } from "../../core/agent/llm";
import { runImprovedPipeline } from "../../core/agent/improved-pipeline";
import type { CheckResult, IcpInput, PipelineResult } from "../../core/agent/types";
import { BudgetGuard, type BudgetSnapshot, type CompanyProvider } from "../../core/data/provider";
import { DEFAULT_RUN_CONFIG, type RunConfig, type Validation } from "../../core/types";
import {
  type SyntheticDependencies,
  runSyntheticPipeline,
  syntheticDependencies,
} from "../../app/results/_lib/synthetic-run";
import { hashCode, hashIp } from "./codes";
import type { LiveKeys } from "./config";
import { type CodeMode, type LiveStore, type RunOutcome } from "./store";
import { type ValidRequest, validateRequest } from "./validate";

const IP_WINDOW_SECONDS = 60;
const IP_LIMIT = 20;
const BAD_CODE_WINDOW_SECONDS = 900;
const BAD_CODE_LIMIT = 5;
const RUN_LOCK_SECONDS = 330;

export const LIVE_RUN_CONFIG: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  max_search_results: 10,
  max_enrichments: 5,
  model: "claude-haiku",
  max_llm_calls_per_run: 20,
  max_output_tokens_per_call: 1500,
};

export const LIVE_SEARCH_SORT = { field: "crustdata_company_id", order: "asc" } as const;

export const SYNTHETIC_NOTICES: readonly string[] = [
  "Synthetic demo: fixture companies and a fake model; your search criteria were not used.",
  "One outreach draft deliberately contains an injected unsupported number so you can see the claim check suppress it.",
];

// ---- Response contract ----------------------------------------------------

// What the injected mapper returns is opaque here. The mapper owns the shape
// of the results and must not copy upstream text into them.
export interface ResultsContext {
  readonly mode: CodeMode;
  readonly model: string;
}

export type ToResults = (result: PipelineResult, ctx: ResultsContext) => unknown;

export type LiveBody =
  | {
      readonly status: "ok";
      readonly mode: CodeMode;
      readonly results: unknown;
      readonly usage: { readonly runsRemaining: number };
      readonly notices: readonly string[];
    }
  | { readonly status: "invalid_request"; readonly field: string; readonly message: string }
  | { readonly status: "rate_limited"; readonly retryAfterSeconds: number; readonly message: string }
  | { readonly status: "live_disabled"; readonly message: string }
  | { readonly status: "invalid_code"; readonly message: string }
  | { readonly status: "no_runs_left"; readonly message: string }
  | { readonly status: "run_in_progress"; readonly message: string }
  | { readonly status: "budget_exhausted"; readonly message: string }
  | { readonly status: "run_failed"; readonly message: string }
  | { readonly status: "live_unavailable"; readonly message: string };

export interface LiveOutcome {
  readonly httpStatus: 200 | 400 | 401 | 403 | 409 | 429 | 502 | 503;
  readonly body: LiveBody;
}

const MESSAGES = {
  live_disabled: "Live runs are switched off right now.",
  invalid_code: "That invite code is not valid.",
  no_runs_left: "This invite code has no runs left.",
  run_in_progress: "A run is already in progress for this code. Try again shortly.",
  budget_exhausted: "The data budget for live runs is used up. Please try again later.",
  run_failed: "The run failed. Please try again later.",
  live_unavailable: "Live mode is unavailable right now. Please try again later.",
  rate_limited: "Too many requests. Please wait before trying again.",
  industry_unmatched: "We could not match that industry. Try a broader term.",
} as const;

const ISSUE_NOTICES: Readonly<Record<string, string | undefined>> = {
  enrich_partial: "Some companies could not be enriched, so those use basic search data only.",
  enrich_no_results: "No companies could be enriched, so results use basic search data only.",
  enrich_failed: "Enrichment failed, so results use basic search data only.",
  enrich_budget_exhausted: "The enrichment budget was reached before every company was enriched.",
  search_no_match: "No companies matched your criteria.",
  search_budget_exhausted: "The search budget was reached.",
  llm_call_cap_reached: "The model-call limit was reached, so some companies were not assessed.",
  llm_stopped: "Assessment stopped early after a model error, so some companies were not assessed.",
  llm_cost_incomplete: "Model cost for this run could not be fully measured.",
};

const GENERIC_ISSUE_MESSAGE = "A step of the run reported a problem.";

const FAILED_ASSESSMENT_MESSAGES: Readonly<Record<string, string | undefined>> = {
  llm_error: "The model could not assess this company.",
  malformed_output: "The model's answer could not be read.",
  truncated: "The model's answer was cut off.",
  invalid_assessment: "The model's assessment failed the checks.",
};
const GENERIC_ASSESSMENT_MESSAGE = "The assessment failed.";

const VALIDATION_REASONS: Readonly<Record<string, string | undefined>> = {
  missing_name: "The company has no name.",
  missing_domain: "The company has no primary domain.",
  junk_website: "The website is not a company site.",
  duplicate_domain: "The company duplicates another result.",
  size_headcount_mismatch: "The size range and headcount disagree.",
  missing_linkedin: "The company has no LinkedIn page.",
};
const GENERIC_VALIDATION_REASON = "The company failed a data check.";
const GENERIC_FINDING_MESSAGE = "The assessment failed a check.";
const FINDING_MESSAGES: Readonly<Record<string, string | undefined>> = {
  fit_score_out_of_range: "The fit score is outside 0-100.",
  criterion_score_out_of_range: "A criterion score is outside 0-100.",
  missing_criterion: "A requested criterion was not scored.",
  unexpected_criterion: "A criterion was scored that was not requested.",
  duplicate_criterion: "A criterion was scored more than once.",
  unknown_fact_reference: "A score references an unknown fact.",
  uncertain_fact_reference: "A score references an uncertain fact.",
  no_citations: "The outreach cites no facts.",
  duplicate_citation: "The outreach cites a fact more than once.",
  unknown_citation: "The outreach cites an unknown fact.",
  model_fact_citation: "The outreach cites a model-written fact.",
  non_citeable_citation: "The outreach cites a fact that cannot be cited.",
  unsupported_number: "The outreach states a number no cited fact supports.",
};

function scrubValidation(v: Validation | undefined): Validation | undefined {
  if (v === undefined) return v;
  return {
    ...v,
    issues: v.issues.map((i) => ({ ...i, reason: VALIDATION_REASONS[i.code] ?? GENERIC_VALIDATION_REASON })),
  };
}

function scrubCheck(c: CheckResult): CheckResult {
  return {
    ...c,
    findings: c.findings.map(({ code, severity }) => ({
      code,
      severity,
      message: FINDING_MESSAGES[code] ?? GENERIC_FINDING_MESSAGE,
    })),
  };
}

// Returns a copy of the pipeline result in which every free-text field that
// can carry upstream, model-error or user text is replaced by a fixed string
// chosen by its code or reason. Never mutates its input. Company data, facts
// and model assessments are the payload and pass through unchanged.
export function scrubResult(result: PipelineResult): PipelineResult {
  return {
    ...result,
    run: { ...result.run, input_description: "Run criteria withheld." },
    issues: result.issues.map((i) => ({ ...i, message: ISSUE_NOTICES[i.code] ?? GENERIC_ISSUE_MESSAGE })),
    prospects: result.prospects.map((p) => {
      const assessment =
        p.assessment.status === "failed"
          ? {
              ...p.assessment,
              message: FAILED_ASSESSMENT_MESSAGES[p.assessment.reason] ?? GENERIC_ASSESSMENT_MESSAGE,
            }
          : p.assessment;
      const scrubbed = { ...p, assessment };
      const search_validation = scrubValidation(p.search_validation);
      const validation = scrubValidation(p.validation);
      return {
        ...scrubbed,
        ...(search_validation !== undefined ? { search_validation } : {}),
        ...(validation !== undefined ? { validation } : {}),
        ...(p.checks !== undefined
          ? {
              checks: {
                ...p.checks,
                assessment: scrubCheck(p.checks.assessment),
                ...(p.checks.claims !== undefined ? { claims: scrubCheck(p.checks.claims) } : {}),
              },
            }
          : {}),
      };
    }),
  };
}

function respond(httpStatus: LiveOutcome["httpStatus"], body: LiveBody): LiveOutcome {
  return { httpStatus, body };
}

const simple = (
  httpStatus: LiveOutcome["httpStatus"],
  status:
    | "live_disabled"
    | "invalid_code"
    | "no_runs_left"
    | "run_in_progress"
    | "budget_exhausted"
    | "run_failed"
    | "live_unavailable",
): LiveOutcome => respond(httpStatus, { status, message: MESSAGES[status] });

// For callers that fail before runLive (e.g. configuration is missing).
export const liveUnavailable = (): LiveOutcome => simple(503, "live_unavailable");

function rateLimited(retryAfterSeconds: number): LiveOutcome {
  const seconds = Number.isFinite(retryAfterSeconds) ? Math.max(1, Math.ceil(retryAfterSeconds)) : 60;
  return respond(429, { status: "rate_limited", retryAfterSeconds: seconds, message: MESSAGES.rate_limited });
}

function noticesFromIssues(issues: readonly { readonly code: string }[]): string[] {
  const out: string[] = [];
  for (const issue of issues) {
    const text = ISSUE_NOTICES[issue.code];
    if (text !== undefined && !out.includes(text)) out.push(text);
  }
  return out;
}

// ---- Dependencies -----------------------------------------------------------

export interface LiveProviderBundle {
  readonly provider: CompanyProvider;
  readonly budget: { snapshot(): BudgetSnapshot };
}

export interface LiveDeps {
  readonly store: LiveStore;
  readonly hmacSecret: string;
  // null when live keys are not configured: synthetic codes still run.
  readonly live: LiveKeys | null;
  readonly now: () => Date;
  // Live factories. Never called in synthetic mode.
  readonly createProvider: (keys: LiveKeys, config: RunConfig) => LiveProviderBundle | Promise<LiveProviderBundle>;
  readonly createLlm: (keys: LiveKeys) => LlmClient | Promise<LlmClient>;
  readonly synthetic?: SyntheticDependencies;
  // Builds the 200 body's results for both modes.
  readonly toResults: ToResults;
}

// The real factories. SDKs are imported lazily so synthetic runs and unit
// tests never load them.
export const realFactories: Pick<LiveDeps, "createProvider" | "createLlm"> = {
  async createProvider(keys, config) {
    const { CrustdataProvider } = await import("../../core/data/crustdata-provider");
    const budget = new BudgetGuard(config);
    const provider = new CrustdataProvider({
      api_key: keys.crustdataApiKey,
      budget,
      search_sort: LIVE_SEARCH_SORT,
    });
    return { provider, budget };
  },
  async createLlm(keys) {
    const { createGatewayLlmClient } = await import("../../core/agent/gateway-client");
    return createGatewayLlmClient({ apiKey: keys.llmApiKey, baseURL: keys.llmBaseUrl });
  },
};

// ---- Orchestration ----------------------------------------------------------

export async function runLive(
  request: { readonly code: unknown; readonly icp: unknown },
  ip: string,
  deps: LiveDeps,
): Promise<LiveOutcome> {
  const checked = validateRequest(request);
  if (!checked.ok) {
    return respond(400, { status: "invalid_request", field: checked.field, message: checked.message });
  }
  const valid = checked.value;

  let reserved: Reserved;
  try {
    const { store, hmacSecret } = deps;
    const ipHash = hashIp(ip, hmacSecret);

    const rate = await store.hit(`ip:${ipHash}`, deps.now(), IP_WINDOW_SECONDS, IP_LIMIT);
    if (!rate.allowed) return rateLimited(rate.retryAfterSeconds);

    const result = await store.reserveRun(hashCode(valid.code, hmacSecret), deps.now(), RUN_LOCK_SECONDS);
    if (!result.ok) {
      switch (result.reason) {
        case "invalid_code":
        case "disabled": {
          const bad = await store.hit(`badcode:${ipHash}`, deps.now(), BAD_CODE_WINDOW_SECONDS, BAD_CODE_LIMIT);
          if (!bad.allowed) return rateLimited(bad.retryAfterSeconds);
          return simple(401, "invalid_code");
        }
        case "no_runs_left":
          return simple(403, "no_runs_left");
        case "run_in_progress":
          return simple(409, "run_in_progress");
        default:
          return simple(503, "live_unavailable");
      }
    }
    reserved = { runId: result.runId, runsRemaining: result.runsRemaining, mode: result.mode };
  } catch {
    return simple(503, "live_unavailable");
  }

  // From here a run exists: every exit must finish or release it.
  const { store } = deps;

  // The kill switch only stops live-mode codes; synthetic codes never read it.
  if (reserved.mode === "live") {
    // Keys missing or live not allowed by the runtime fail-safe: do not attempt the run.
    if (deps.live === null) {
      await giveBack(store, reserved.runId);
      return simple(503, "live_disabled");
    }
    let enabled: boolean;
    try {
      enabled = await store.isLiveEnabled();
    } catch {
      await giveBack(store, reserved.runId);
      return simple(503, "live_unavailable");
    }
    if (!enabled) {
      await giveBack(store, reserved.runId);
      return simple(503, "live_disabled");
    }
  }

  const settle = async (op: () => Promise<void>) => {
    try {
      await op();
    } catch {
      // The outcome is already decided; a store failure cannot change it.
    }
  };
  const failed = async (outcome: Partial<RunOutcome> = {}): Promise<LiveOutcome> => {
    await settle(() =>
      store.finishRun(reserved.runId, {
        status: "failed",
        searched: 0,
        enriched: 0,
        providerCostUsd: 0,
        modelCostUsd: 0,
        errorCategory: "run_failed",
        ...outcome,
      }),
    );
    return simple(502, "run_failed");
  };

  try {
    return reserved.mode === "synthetic"
      ? await runSynthetic(reserved, deps, failed)
      : await runLiveMode(valid, reserved, deps, failed);
  } catch {
    return failed();
  }
}

async function giveBack(store: LiveStore, runId: string): Promise<void> {
  try {
    await store.releaseRun(runId);
  } catch {
    // Nothing more can be done; the lock expires on its own.
  }
}

// The user already has what the run produced, so a bookkeeping failure is
// retried once and then ignored. It is never recorded as a different status.
async function finishCompleted(store: LiveStore, runId: string, outcome: RunOutcome): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.finishRun(runId, outcome);
      return;
    } catch {
      // Retry once, then give up.
    }
  }
}

interface Reserved {
  readonly runId: string;
  readonly runsRemaining: number;
  readonly mode: CodeMode;
}

type Failed = (outcome?: Partial<RunOutcome>) => Promise<LiveOutcome>;

async function runSynthetic(reserved: Reserved, deps: LiveDeps, failed: Failed): Promise<LiveOutcome> {
  const run = await runSyntheticPipeline("synthetic", deps.synthetic ?? syntheticDependencies);
  if (run.kind !== "ok") return failed();
  const { result } = run;
  const searched = result.usage.provider.searched;
  const enriched = result.usage.provider.enriched;
  const results = deps.toResults(scrubResult(result), { mode: "synthetic", model: "fake" });
  await finishCompleted(deps.store, reserved.runId, {
    status: "completed",
    searched,
    enriched,
    providerCostUsd: 0,
    modelCostUsd: 0,
  });
  const notices = [...SYNTHETIC_NOTICES, ...noticesFromIssues(result.issues)];
  return respond(200, {
    status: "ok",
    mode: "synthetic",
    results,
    usage: { runsRemaining: reserved.runsRemaining },
    notices,
  });
}

async function runLiveMode(
  valid: ValidRequest,
  reserved: Reserved,
  deps: LiveDeps,
  failed: Failed,
): Promise<LiveOutcome> {
  const { store } = deps;
  const release = async (): Promise<LiveOutcome> => {
    await giveBack(store, reserved.runId);
    return simple(502, "run_failed");
  };

  // Before the first paid call: any failure gives the run back.
  let bundle: LiveProviderBundle;
  let llm: LlmClient;
  let industry: string;
  const notices: string[] = [];
  try {
    if (deps.live === null) return await release();
    bundle = await deps.createProvider(deps.live, LIVE_RUN_CONFIG);
    llm = await deps.createLlm(deps.live);

    const suggestions = await bundle.provider.autocompleteIndustry(valid.icp.industry);
    if (!suggestions.ok && suggestions.error.category === "no_match") {
      await store.releaseRun(reserved.runId);
      return respond(400, {
        status: "invalid_request",
        field: "industry",
        message: MESSAGES.industry_unmatched,
      });
    }
    if (!suggestions.ok || suggestions.data.length === 0) return await release();
    industry = suggestions.data[0];
    notices.push(`Searched the industry "${industry.slice(0, 80)}", the closest match to what you entered.`);
  } catch {
    return release();
  }

  const icp: IcpInput = {
    industry,
    employee_count_ranges: valid.icp.sizes,
    locations: [valid.icp.country],
    keywords: [],
    excluded_domains: [],
  };

  const config: RunConfig = { ...LIVE_RUN_CONFIG, model: deps.live.llmModel ?? LIVE_RUN_CONFIG.model };

  let result: PipelineResult;
  try {
    result = await runImprovedPipeline(
      icp,
      { provider: bundle.provider, budget: bundle.budget, llm, fact_provider: "crustdata" },
      { config },
    );
  } catch {
    const snap = safeSnapshot(bundle.budget);
    return failed({
      searched: snap.searched,
      enriched: snap.enriched,
      providerCostUsd: snap.cost_usd,
      errorCategory: "pipeline_exception",
    });
  }

  const searched = result.usage.provider.searched;
  const enriched = result.usage.provider.enriched;
  const providerCostUsd = result.usage.provider.cost_usd;
  const modelCostUsd = result.usage.llm_cost.known_usd;

  if (result.status === "stopped") {
    const exhausted = result.issues.some((i) => i.error_category === "budget_cap_reached");
    const outcome: RunOutcome = {
      status: exhausted ? "budget_exhausted" : "failed",
      searched,
      enriched,
      providerCostUsd,
      modelCostUsd,
      errorCategory: exhausted ? "budget_cap_reached" : "pipeline_stopped",
    };
    try {
      await store.finishRun(reserved.runId, outcome);
    } catch {
      // The response is already decided.
    }
    return simple(exhausted ? 503 : 502, exhausted ? "budget_exhausted" : "run_failed");
  }

  let results: unknown;
  try {
    results = deps.toResults(scrubResult(result), { mode: "live", model: config.model });
  } catch {
    return failed({ searched, enriched, providerCostUsd, modelCostUsd, errorCategory: "results_mapping" });
  }

  await finishCompleted(store, reserved.runId, {
    status: "completed",
    searched,
    enriched,
    providerCostUsd,
    modelCostUsd,
  });
  return respond(200, {
    status: "ok",
    mode: "live",
    results,
    usage: { runsRemaining: reserved.runsRemaining },
    notices: [...notices, ...noticesFromIssues(result.issues)],
  });
}

function safeSnapshot(budget: { snapshot(): BudgetSnapshot }): BudgetSnapshot {
  try {
    return budget.snapshot();
  } catch {
    return { cost_usd: 0, searched: 0, enriched: 0 };
  }
}
