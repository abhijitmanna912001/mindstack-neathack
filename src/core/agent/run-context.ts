// Shared run machinery for the baseline and improved pipelines: the root
// span, planning and search, the enrich step, model calls with their usage
// and cost accounting, and the final PipelineResult. Each pipeline keeps its
// own flow; this module only holds the parts they must do identically.

import type { SearchFilters } from "../data/provider";
import { DEV_RUN_CONFIG, type Assessment, type RawCompany, type RunConfig } from "../types";
import { parseAssessment } from "./assess";
import { type EnrichStepResult, enrichInSearchOrder } from "./enrich";
import { assessmentCriteria, buildSearchFilters, describeIcp } from "./icp";
import type { LlmErrorCategory, LlmMessage, LlmResponse } from "./llm";
import type { LlmCostBasis, LlmKeySpend } from "./llm-cost";
import { LLM_TEMPERATURE } from "./llm-policy";
import { RunRecorder } from "./recorder";
import {
  noopTracer,
  type PipelineSpan,
  type PipelineTracer,
  type TraceAttributes,
} from "./tracer";
import type {
  AssessmentOutcome,
  BaselineProspect,
  EnrichmentOutcome,
  IcpInput,
  ImprovedRunMetrics,
  LlmCallRecord,
  LlmCostSummary,
  PipelineDeps,
  PipelineIssue,
  PipelineKind,
  PipelineOptions,
  PipelineResult,
  PipelineStatus,
} from "./types";

export type SearchOutcome =
  | { readonly kind: "found"; readonly companies: readonly RawCompany[] }
  | { readonly kind: "empty" }
  | { readonly kind: "stopped" };

// What a model response turned into before any pipeline-specific checks.
export type ParsedModelResponse =
  | { readonly ok: true; readonly assessment: Assessment }
  | { readonly ok: false; readonly outcome: AssessmentOutcome };

// Span attributes for one model call, from the same record the result holds.
export function callAttributes(call: LlmCallRecord): TraceAttributes {
  return {
    "llm.call_number": call.call_number,
    "llm.attempts": call.attempts,
    "llm.header_source": call.header_source,
    "llm.cost_basis": call.cost.basis,
    ...(call.cost.basis !== "unavailable" ? { "llm.cost_usd": call.cost.usd } : {}),
    ...(call.usage
      ? {
          "llm.prompt_tokens": call.usage.prompt_tokens,
          "llm.completion_tokens": call.usage.completion_tokens,
        }
      : {}),
    ...(call.key_spend?.spend_usd !== undefined
      ? { "llm.key_spend_usd": call.key_spend.spend_usd }
      : {}),
    ...(call.key_spend?.max_budget_usd !== undefined
      ? { "llm.key_max_budget_usd": call.key_spend.max_budget_usd }
      : {}),
  };
}

// An error every later call would repeat: stop spending attempts on it.
export function stopCategory(outcome: AssessmentOutcome): LlmErrorCategory | undefined {
  return outcome.status === "failed" &&
    (outcome.error_category === "auth_failed" || outcome.error_category === "rate_limited")
    ? outcome.error_category
    : undefined;
}

export class PipelineRun {
  readonly icp: IcpInput;
  readonly deps: PipelineDeps;
  readonly config: RunConfig;
  readonly tracer: PipelineTracer;
  readonly trace_id: string;
  readonly recorder: RunRecorder;
  readonly input_description: string;
  readonly criteria: readonly string[];
  readonly issues: PipelineIssue[] = [];
  private readonly kind: PipelineKind;
  private llmHttpAttempts = 0;
  private readonly llmCost: {
    gateway_reported_usd: number;
    estimated_usd: number;
    known_usd: number;
    calls_by_basis: Record<LlmCostBasis, number>;
    latest_key_spend?: LlmKeySpend;
  } = {
    gateway_reported_usd: 0,
    estimated_usd: 0,
    known_usd: 0,
    calls_by_basis: { gateway_reported: 0, estimated: 0, unavailable: 0 },
  };

  constructor(icp: IcpInput, deps: PipelineDeps, options: PipelineOptions, kind: PipelineKind) {
    this.icp = icp;
    this.deps = deps;
    this.kind = kind;
    this.config = options.config ?? DEV_RUN_CONFIG;
    this.tracer = deps.tracer ?? noopTracer;
    this.trace_id = deps.trace_id ?? crypto.randomUUID();
    this.recorder = new RunRecorder(deps.now ?? Date.now);
    this.input_description = describeIcp(icp);
    this.criteria = assessmentCriteria(icp);
  }

  // Runs `body` inside the WORKFLOW root span.
  workflow(
    name: string,
    body: (root: PipelineSpan) => Promise<PipelineResult>,
  ): Promise<PipelineResult> {
    const { config, trace_id } = this;
    return this.tracer.span(
      {
        name,
        kind: "WORKFLOW",
        input: { trace_id, icp: this.icp },
        attributes: {
          "signalscout.trace_id": trace_id,
          "signalscout.pipeline": this.kind,
          "signalscout.model": config.model,
          "signalscout.max_search_results": config.max_search_results,
          "signalscout.max_enrichments": config.max_enrichments,
          "signalscout.max_llm_calls_per_run": config.max_llm_calls_per_run,
          "signalscout.max_output_tokens_per_call": config.max_output_tokens_per_call,
        },
      },
      body,
    );
  }

  // `delivered` defaults to every prospect in the result. `metrics` is only
  // passed by the improved pipeline.
  finish(
    root: PipelineSpan,
    status: PipelineStatus,
    filters: SearchFilters,
    prospects: readonly BaselineProspect[],
    delivered: number = prospects.length,
    metrics?: ImprovedRunMetrics,
  ): PipelineResult {
    const { recorder, config } = this;
    recorder.counts.delivered = delivered;
    const run = recorder.build(this.trace_id, this.input_description, config);
    const provider = this.deps.budget.snapshot();
    const llm_cost: LlmCostSummary = {
      ...this.llmCost,
      calls_by_basis: { ...this.llmCost.calls_by_basis },
      complete: this.llmCost.calls_by_basis.unavailable === 0,
    };
    root.setAttributes({
      "signalscout.status": status,
      "signalscout.searched": run.counts.searched,
      "signalscout.enriched": run.counts.enriched,
      "signalscout.delivered": run.counts.delivered,
      "signalscout.llm_calls": run.counts.llm_calls,
      "signalscout.llm_http_attempts": this.llmHttpAttempts,
      "signalscout.provider_cost_usd": provider.cost_usd,
      "signalscout.llm_cost_known_usd": llm_cost.known_usd,
      "signalscout.llm_cost_complete": llm_cost.complete,
      "signalscout.issue_codes": this.issues.map((i) => i.code),
    });
    return {
      pipeline: this.kind,
      status,
      run,
      filters,
      prospects,
      issues: this.issues,
      usage: {
        provider,
        max_search_results: config.max_search_results,
        max_enrichments: config.max_enrichments,
        llm_calls: run.counts.llm_calls,
        max_llm_calls_per_run: config.max_llm_calls_per_run,
        llm_http_attempts: this.llmHttpAttempts,
        llm_cost,
      },
      ...(metrics ? { metrics } : {}),
    };
  }

  // ICP -> SearchFilters (free industry autocomplete).
  async plan(): Promise<SearchFilters> {
    const plan = await this.recorder.time("plan", () =>
      this.tracer.span({ name: "plan", kind: "CHAIN", input: this.icp }, async (span) => {
        const result = await buildSearchFilters(this.icp, this.deps.provider);
        span.setAttributes({
          "search.industries": result.filters.industries,
          "search.country": result.filters.country,
          "search.employee_count_ranges": result.filters.employee_count_ranges,
        });
        return result;
      }),
    );
    this.recorder.addCost("plan", plan.cost_usd);
    this.issues.push(...plan.issues);
    return plan.filters;
  }

  async search(filters: SearchFilters): Promise<SearchOutcome> {
    const { config, deps, recorder, issues } = this;
    return recorder.time("search", () =>
      this.tracer.span(
        { name: "search", kind: "TOOL", input: filters },
        async (span): Promise<SearchOutcome> => {
          const limit = config.max_search_results - deps.budget.snapshot().searched;
          if (limit <= 0) {
            issues.push({
              step: "search",
              code: "search_budget_exhausted",
              message: "No search results left in this run's budget.",
            });
            span.setAttributes({ "provider.outcome": "budget_exhausted" });
            return { kind: "stopped" };
          }
          const result = await deps.provider.searchCompanies(filters, limit);
          if (result.ok) {
            recorder.addCost("search", result.cost_usd);
            recorder.counts.searched = result.data.length;
            span.setAttributes({
              "provider.outcome": "ok",
              "provider.limit": limit,
              "provider.returned": result.data.length,
              "provider.cost_usd": result.cost_usd,
              "provider.calls": result.calls,
            });
            return { kind: "found", companies: result.data };
          }
          const category = result.error.category;
          span.setAttributes({ "provider.outcome": category, "provider.limit": limit });
          if (category === "no_match") {
            issues.push({
              step: "search",
              code: "search_no_match",
              message: "No companies match the search filters.",
              error_category: category,
            });
            return { kind: "empty" };
          }
          issues.push({
            step: "search",
            code: category === "budget_cap_reached" ? "search_budget_exhausted" : "search_failed",
            message: `Search failed with ${category}: ${result.error.message}`,
            error_category: category,
          });
          return { kind: "stopped" };
        },
      ),
    );
  }

  // Enriches `companies` in order within the remaining enrichment budget.
  async enrich(companies: readonly RawCompany[]): Promise<EnrichStepResult> {
    const { config, deps, recorder } = this;
    const result = await recorder.time("enrich", () =>
      this.tracer.span(
        {
          name: "enrich",
          kind: "TOOL",
          input: { companies: companies.map((c) => c.crustdata_company_id) },
        },
        async (span) => {
          const remaining = config.max_enrichments - deps.budget.snapshot().enriched;
          const step = await enrichInSearchOrder(companies, deps.provider, remaining);
          const statusCount = (status: EnrichmentOutcome["status"]) =>
            step.outcomes.filter((o) => o.status === status).length;
          span.setAttributes({
            "enrich.remaining_before": Math.max(0, remaining),
            "enrich.requested": step.requested,
            "enrich.enriched": statusCount("enriched"),
            "enrich.not_returned": statusCount("not_returned"),
            "enrich.skipped_budget": statusCount("skipped_budget"),
            "enrich.skipped_no_linkedin": statusCount("skipped_no_linkedin"),
            "enrich.failed": statusCount("failed"),
            "provider.cost_usd": step.cost_usd,
          });
          return step;
        },
      ),
    );
    recorder.addCost("enrich", result.cost_usd);
    recorder.counts.enriched = result.enriched.size;
    this.issues.push(...result.issues);
    return result;
  }

  // True when the model-call cap leaves room for another logical call.
  canCallModel(): boolean {
    return this.recorder.counts.llm_calls < this.config.max_llm_calls_per_run;
  }

  // One logical model call: counts it, records usage and cost on the result
  // and the span, and never throws.
  async callModel(
    messages: readonly LlmMessage[],
    span: PipelineSpan,
  ): Promise<{ response: LlmResponse; llm_call: LlmCallRecord }> {
    const { config, recorder } = this;
    recorder.counts.llm_calls += 1;
    const call_number = recorder.counts.llm_calls;
    let response: LlmResponse;
    try {
      response = await this.deps.llm.complete({
        model: config.model,
        messages,
        max_output_tokens: config.max_output_tokens_per_call,
        temperature: LLM_TEMPERATURE,
      });
    } catch (err) {
      // Clients should not throw; guard anyway so one company cannot end the run.
      response = {
        ok: false,
        error: {
          category: "model_error",
          message: err instanceof Error ? err.message : String(err),
        },
        meta: {
          model: config.model,
          attempts: 1,
          retry_waits_ms: [],
          cost: { basis: "unavailable" },
          header_source: "none",
        },
      };
    }

    const llm_call: LlmCallRecord = { ...response.meta, call_number };
    this.recordCall(llm_call);
    llm_call.retry_waits_ms.forEach((wait_ms, i) =>
      span.addEvent("llm_retry", { "llm.retry": i + 1, "llm.retry_wait_ms": wait_ms }),
    );
    span.setAttributes(callAttributes(llm_call));
    return { response, llm_call };
  }

  // Turns a model response into an Assessment, or into the failed outcome the
  // baseline has always produced (llm_error, truncated, malformed_output).
  parseResponse(response: LlmResponse, span: PipelineSpan): ParsedModelResponse {
    if (!response.ok) {
      span.setAttributes({
        "assess.outcome": "llm_error",
        "llm.error_category": response.error.category,
      });
      return {
        ok: false,
        outcome: {
          status: "failed",
          reason: "llm_error",
          message: response.error.message,
          error_category: response.error.category,
        },
      };
    }
    span.setAttributes({ "llm.truncated": response.truncated });
    if (!this.deps.llm.records_llm_spans) span.setAttributes({ "llm.output": response.text });

    if (response.truncated) {
      span.setAttributes({ "assess.outcome": "truncated" });
      return {
        ok: false,
        outcome: {
          status: "failed",
          reason: "truncated",
          message: `Model output hit the ${this.config.max_output_tokens_per_call}-token limit.`,
        },
      };
    }
    const parsed = parseAssessment(response.text);
    span.setAttributes({ "assess.outcome": parsed.ok ? "assessed" : "malformed_output" });
    return parsed.ok
      ? { ok: true, assessment: parsed.assessment }
      : { ok: false, outcome: { status: "failed", reason: "malformed_output", message: parsed.message } };
  }

  // Run-level notes at the end of the assess step, in a fixed order.
  addAssessIssues(stoppedBy: LlmErrorCategory | undefined, capReached: boolean): void {
    if (stoppedBy) {
      this.issues.push({
        step: "assess",
        code: "llm_stopped",
        message: `Stopped assessing after a ${stoppedBy} model error.`,
        llm_error_category: stoppedBy,
      });
    }
    if (capReached) {
      this.issues.push({
        step: "assess",
        code: "llm_call_cap_reached",
        message: `Stopped assessing after ${this.config.max_llm_calls_per_run} model calls.`,
      });
    }
    if (this.llmCost.calls_by_basis.unavailable > 0) {
      this.issues.push({
        step: "assess",
        code: "llm_cost_incomplete",
        message: `Model cost is unavailable for ${this.llmCost.calls_by_basis.unavailable} call(s); the recorded assess cost is a lower bound.`,
      });
    }
  }

  // Attributes for the assess span, summarising its outcomes.
  assessAttributes(out: readonly BaselineProspect[]): TraceAttributes {
    const { counts } = this.recorder;
    return {
      "llm.calls": counts.llm_calls,
      "llm.http_attempts": this.llmHttpAttempts,
      "llm.input_tokens": counts.llm_input_tokens,
      "llm.output_tokens": counts.llm_output_tokens,
      "llm.cost_known_usd": this.llmCost.known_usd,
      "llm.cost_complete": this.llmCost.calls_by_basis.unavailable === 0,
      "assess.assessed": out.filter((p) => p.assessment.status === "assessed").length,
      "assess.failed": out.filter((p) => p.assessment.status === "failed").length,
      "assess.not_assessed": out.filter((p) => p.assessment.status === "not_assessed").length,
    };
  }

  private recordCall(call: LlmCallRecord): void {
    const { recorder, llmCost } = this;
    this.llmHttpAttempts += call.attempts;
    if (call.usage) {
      recorder.counts.llm_input_tokens += call.usage.prompt_tokens;
      recorder.counts.llm_output_tokens += call.usage.completion_tokens;
    }
    llmCost.calls_by_basis[call.cost.basis] += 1;
    if (call.cost.basis === "gateway_reported") {
      llmCost.gateway_reported_usd += call.cost.usd;
      recorder.addCost("assess", call.cost.usd);
    } else if (call.cost.basis === "estimated") {
      llmCost.estimated_usd += call.cost.usd;
      recorder.addCost("assess", call.cost.usd);
    }
    llmCost.known_usd = llmCost.gateway_reported_usd + llmCost.estimated_usd;
    if (call.key_spend) llmCost.latest_key_spend = call.key_spend;
  }
}
