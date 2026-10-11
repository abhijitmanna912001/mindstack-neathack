// Presentation DTO for the live beta, for both synthetic and live codes.
// Built field by field from an improved-pipeline result: nothing is spread
// from pipeline objects, and every displayed message is fixed text chosen by
// code (see safe-text.ts). It reuses the results page's ProspectDto and
// MetricsDto without changing ResultsDto or toResultsDto.
//
// Its signature matches the server's injected results mapper:
// (result, { mode, model }) => results.

import type { LlmCostSummary, PipelineResult, PipelineStatus } from "../../../core/agent/types";
import {
  type MetricsDto,
  metricsDto,
  type ProspectDto,
  toProspectDto,
} from "../../results/_lib/presentation";
import { issueMessage, safeCode, safeProspect } from "./safe-text";

export type LiveMode = "synthetic" | "live";

export interface LiveResultsContext {
  readonly mode: LiveMode;
  // The model the run used: the fake model's name in synthetic mode.
  readonly model: string;
}

// How the provider cost was arrived at.
// simulated_fixture_prices: synthetic mode. FixtureProvider's per-record
//   prices; nothing was called or charged.
// estimated_per_record: live mode. Records searched and enriched, priced at
//   the measured per-record rates. An estimate, not an invoice.
export type ProviderCostBasis = "simulated_fixture_prices" | "estimated_per_record";

// What kind of known model cost model_usd holds, from llm_cost.calls_by_basis.
// It describes the known costs only; completeness is model_complete's job.
// none: no external model cost. No model calls in live mode; always in
//   synthetic mode, whose fake-model calls call no external model.
// gateway_reported: every known cost was reported by the gateway.
// estimated: every known cost was estimated from token usage at the
//   fallback rates.
// mixed: known costs of both kinds.
// unavailable: model calls were made but no call has a known cost.
export type ModelCostBasis = "none" | "gateway_reported" | "estimated" | "mixed" | "unavailable";

export interface LiveCostDto {
  readonly provider_usd: number;
  readonly provider_basis: ProviderCostBasis;
  // The known model cost, usage.llm_cost.known_usd, as reported (0 in
  // synthetic mode). Read it with model_basis and model_complete: 0 with
  // basis "unavailable" means unknown, not free.
  readonly model_usd: number;
  readonly model_basis: ModelCostBasis;
  // True only when every model call has a known cost (and when there were
  // none). When false, model_usd is a lower bound, never a total.
  readonly model_complete: boolean;
  // Model calls whose cost is not known, including calls the basis counts
  // fail to account for.
  readonly model_calls_unavailable: number;
}

export interface LiveResultsDto {
  readonly run: {
    readonly status: PipelineStatus;
    readonly mode: LiveMode;
    readonly data_source: "fixtures" | "crustdata";
    readonly model: string;
    readonly fact_provider: "fixture" | "crustdata";
    readonly limits: {
      readonly max_search_results: number;
      readonly max_enrichments: number;
      readonly max_llm_calls_per_run: number;
    };
    readonly counts: {
      readonly searched: number;
      readonly enriched: number;
      readonly delivered: number;
      readonly assessed: number;
      readonly model_calls: number;
    };
    readonly cost: LiveCostDto;
  };
  readonly metrics: MetricsDto | null;
  readonly issues: readonly { readonly code: string; readonly message: string }[];
  readonly prospects: readonly ProspectDto[];
}

const MAX_MODEL_NAME_LENGTH = 64;

function modelName(model: string): string {
  const clean = model.replace(/[^\w.:/-]+/g, " ").trim().slice(0, MAX_MODEL_NAME_LENGTH);
  return clean === "" ? "unknown" : clean;
}

function count(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

type ModelCost = Pick<LiveCostDto, "model_usd" | "model_basis" | "model_complete" | "model_calls_unavailable">;

// Synthetic mode has no external model cost. Its fake-model calls are logical
// calls inside the app, so FakeLlmClient's simulated cost is not reported.
export const SYNTHETIC_MODEL_COST: ModelCost = {
  model_usd: 0,
  model_basis: "none",
  model_complete: true,
  model_calls_unavailable: 0,
};

export function modelCost(cost: LlmCostSummary, modelCalls: number): ModelCost {
  const gateway = count(cost.calls_by_basis.gateway_reported);
  const estimated = count(cost.calls_by_basis.estimated);
  const recorded = gateway + estimated + count(cost.calls_by_basis.unavailable);
  // Calls the basis counts do not account for are unavailable too, so a
  // missing record never disappears or reads as "no model calls".
  const unavailable = count(cost.calls_by_basis.unavailable) + Math.max(0, count(modelCalls) - recorded);

  // The basis describes the known costs only.
  let basis: ModelCostBasis;
  if (gateway > 0 && estimated > 0) basis = "mixed";
  else if (gateway > 0) basis = "gateway_reported";
  else if (estimated > 0) basis = "estimated";
  else basis = unavailable > 0 ? "unavailable" : "none";

  return {
    model_usd: cost.known_usd,
    model_basis: basis,
    // Every call must have a known cost, and the pipeline must agree.
    model_complete: unavailable === 0 && (basis === "none" || cost.complete),
    model_calls_unavailable: unavailable,
  };
}

export function toLiveResultsDto(result: PipelineResult, ctx: LiveResultsContext): LiveResultsDto {
  const live = ctx.mode === "live";
  return {
    run: {
      status: result.status,
      mode: live ? "live" : "synthetic",
      data_source: live ? "crustdata" : "fixtures",
      model: modelName(ctx.model),
      fact_provider: live ? "crustdata" : "fixture",
      limits: {
        max_search_results: result.usage.max_search_results,
        max_enrichments: result.usage.max_enrichments,
        max_llm_calls_per_run: result.usage.max_llm_calls_per_run,
      },
      counts: {
        searched: result.run.counts.searched,
        enriched: result.run.counts.enriched,
        delivered: result.run.counts.delivered,
        assessed: result.prospects.filter((p) => p.assessment.status === "assessed").length,
        model_calls: result.run.counts.llm_calls,
      },
      cost: {
        provider_usd: result.usage.provider.cost_usd,
        provider_basis: live ? "estimated_per_record" : "simulated_fixture_prices",
        ...(live ? modelCost(result.usage.llm_cost, result.run.counts.llm_calls) : SYNTHETIC_MODEL_COST),
      },
    },
    metrics: result.metrics ? metricsDto(result.metrics) : null,
    issues: result.issues.map((i) => ({ code: safeCode(i.code), message: issueMessage(i.code) })),
    prospects: result.prospects.map((p) => safeProspect(toProspectDto(p))),
  };
}
