// Naive baseline pipeline: plan -> search -> enrich -> assess. It deliberately
// skips validation, deduplication, buildFacts(), validateAssessment() and
// checkClaims(), so its trace shows what the unguarded agent does.
// No network of its own: data comes from the CompanyProvider and model output
// from the LlmClient passed in.

import type { SearchFilters } from "../data/provider";
import { DEV_RUN_CONFIG, type RawCompany } from "../types";
import { buildAssessmentMessages, parseAssessment } from "./assess";
import { enrichInSearchOrder } from "./enrich";
import { assessmentCriteria, buildSearchFilters, describeIcp } from "./icp";
import type { LlmErrorCategory, LlmResponse } from "./llm";
import type { LlmCostBasis, LlmKeySpend } from "./llm-cost";
import { LLM_TEMPERATURE } from "./llm-policy";
import { RunRecorder } from "./recorder";
import { noopTracer, type TraceAttributes } from "./tracer";
import type {
  AssessmentOutcome,
  BaselineProspect,
  EnrichmentOutcome,
  IcpInput,
  LlmCallRecord,
  LlmCostSummary,
  PipelineDeps,
  PipelineIssue,
  PipelineOptions,
  PipelineResult,
  PipelineStatus,
} from "./types";

// Span attributes for one model call, from the same record the result holds.
function callAttributes(call: LlmCallRecord): TraceAttributes {
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

type SearchOutcome =
  | { readonly kind: "found"; readonly companies: readonly RawCompany[] }
  | { readonly kind: "empty" }
  | { readonly kind: "stopped" };

export async function runBaselinePipeline(
  icp: IcpInput,
  deps: PipelineDeps,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const config = options.config ?? DEV_RUN_CONFIG;
  const assessScope = options.assess ?? "all_searched";
  const tracer = deps.tracer ?? noopTracer;
  const trace_id = deps.trace_id ?? crypto.randomUUID();
  const recorder = new RunRecorder(deps.now ?? Date.now);
  const input_description = describeIcp(icp);
  const issues: PipelineIssue[] = [];
  let llmHttpAttempts = 0;
  const llmCost: {
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

  return tracer.span(
    {
      name: "signalscout_baseline_run",
      kind: "WORKFLOW",
      input: { trace_id, icp },
      attributes: {
        "signalscout.trace_id": trace_id,
        "signalscout.pipeline": "naive_baseline",
        "signalscout.model": config.model,
        "signalscout.max_search_results": config.max_search_results,
        "signalscout.max_enrichments": config.max_enrichments,
        "signalscout.max_llm_calls_per_run": config.max_llm_calls_per_run,
        "signalscout.max_output_tokens_per_call": config.max_output_tokens_per_call,
      },
    },
    async (root) => {
      const finish = (
        status: PipelineStatus,
        filters: SearchFilters,
        prospects: readonly BaselineProspect[],
      ): PipelineResult => {
        recorder.counts.delivered = prospects.length;
        const run = recorder.build(trace_id, input_description, config);
        const provider = deps.budget.snapshot();
        const llm_cost: LlmCostSummary = {
          ...llmCost,
          calls_by_basis: { ...llmCost.calls_by_basis },
          complete: llmCost.calls_by_basis.unavailable === 0,
        };
        root.setAttributes({
          "signalscout.status": status,
          "signalscout.searched": run.counts.searched,
          "signalscout.enriched": run.counts.enriched,
          "signalscout.delivered": run.counts.delivered,
          "signalscout.llm_calls": run.counts.llm_calls,
          "signalscout.llm_http_attempts": llmHttpAttempts,
          "signalscout.provider_cost_usd": provider.cost_usd,
          "signalscout.llm_cost_known_usd": llm_cost.known_usd,
          "signalscout.llm_cost_complete": llm_cost.complete,
          "signalscout.issue_codes": issues.map((i) => i.code),
        });
        return {
          status,
          run,
          filters,
          prospects,
          issues,
          usage: {
            provider,
            max_search_results: config.max_search_results,
            max_enrichments: config.max_enrichments,
            llm_calls: run.counts.llm_calls,
            max_llm_calls_per_run: config.max_llm_calls_per_run,
            llm_http_attempts: llmHttpAttempts,
            llm_cost,
          },
        };
      };

      // 1. Plan: ICP -> SearchFilters (free industry autocomplete).
      const plan = await recorder.time("plan", () =>
        tracer.span({ name: "plan", kind: "CHAIN", input: icp }, async (span) => {
          const result = await buildSearchFilters(icp, deps.provider);
          span.setAttributes({
            "search.industries": result.filters.industries,
            "search.country": result.filters.country,
            "search.employee_count_ranges": result.filters.employee_count_ranges,
          });
          return result;
        }),
      );
      recorder.addCost("plan", plan.cost_usd);
      issues.push(...plan.issues);
      const filters = plan.filters;

      // 2. Search.
      const search = await recorder.time("search", () =>
        tracer.span(
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
      if (search.kind === "stopped") return finish("stopped", filters, []);
      if (search.kind === "empty") return finish("completed_empty", filters, []);
      const companies = search.companies;

      // 3. Enrich in search order, within the remaining enrichment budget.
      const enrich = await recorder.time("enrich", () =>
        tracer.span(
          {
            name: "enrich",
            kind: "TOOL",
            input: { companies: companies.map((c) => c.crustdata_company_id) },
          },
          async (span) => {
            const remaining = config.max_enrichments - deps.budget.snapshot().enriched;
            const result = await enrichInSearchOrder(companies, deps.provider, remaining);
            const statusCount = (status: EnrichmentOutcome["status"]) =>
              result.outcomes.filter((o) => o.status === status).length;
            span.setAttributes({
              "enrich.remaining_before": Math.max(0, remaining),
              "enrich.requested": result.requested,
              "enrich.enriched": statusCount("enriched"),
              "enrich.not_returned": statusCount("not_returned"),
              "enrich.skipped_budget": statusCount("skipped_budget"),
              "enrich.skipped_no_linkedin": statusCount("skipped_no_linkedin"),
              "enrich.failed": statusCount("failed"),
              "provider.cost_usd": result.cost_usd,
            });
            return result;
          },
        ),
      );
      recorder.addCost("enrich", enrich.cost_usd);
      recorder.counts.enriched = enrich.enriched.size;
      issues.push(...enrich.issues);

      const pending = companies.map((company, i) => ({
        raw: enrich.enriched.get(i) ?? company,
        enrichment: enrich.outcomes[i],
      }));

      // 4. Assess, one company at a time, within the model-call cap.
      const criteria = assessmentCriteria(icp);
      const prospects = await recorder.time("assess", () =>
        tracer.span(
          { name: "assess", kind: "AGENT", input: { companies: pending.length, criteria } },
          async (span) => {
            const out: BaselineProspect[] = [];
            let capReached = false;
            let stoppedBy: LlmErrorCategory | undefined;
            // Sequential on purpose: no parallel model calls.
            for (const prospect of pending) {
              if (assessScope === "enriched_only" && prospect.enrichment.status !== "enriched") {
                out.push({ ...prospect, assessment: { status: "not_assessed", reason: "not_enriched" } });
                continue;
              }
              if (stoppedBy) {
                out.push({ ...prospect, assessment: { status: "not_assessed", reason: "llm_stopped" } });
                continue;
              }
              if (recorder.counts.llm_calls >= config.max_llm_calls_per_run) {
                capReached = true;
                out.push({ ...prospect, assessment: { status: "not_assessed", reason: "llm_call_cap" } });
                continue;
              }
              const { assessment, llm_call } = await assessOne(prospect);
              out.push({ ...prospect, assessment, llm_call });
              // Every later call would fail the same way, so stop spending attempts.
              if (
                assessment.status === "failed" &&
                (assessment.error_category === "auth_failed" ||
                  assessment.error_category === "rate_limited")
              ) {
                stoppedBy = assessment.error_category;
              }
            }
            if (stoppedBy) {
              issues.push({
                step: "assess",
                code: "llm_stopped",
                message: `Stopped assessing after a ${stoppedBy} model error.`,
                llm_error_category: stoppedBy,
              });
            }
            if (capReached) {
              issues.push({
                step: "assess",
                code: "llm_call_cap_reached",
                message: `Stopped assessing after ${config.max_llm_calls_per_run} model calls.`,
              });
            }
            if (llmCost.calls_by_basis.unavailable > 0) {
              issues.push({
                step: "assess",
                code: "llm_cost_incomplete",
                message: `Model cost is unavailable for ${llmCost.calls_by_basis.unavailable} call(s); the recorded assess cost is a lower bound.`,
              });
            }
            span.setAttributes({
              "llm.calls": recorder.counts.llm_calls,
              "llm.http_attempts": llmHttpAttempts,
              "llm.input_tokens": recorder.counts.llm_input_tokens,
              "llm.output_tokens": recorder.counts.llm_output_tokens,
              "llm.cost_known_usd": llmCost.known_usd,
              "llm.cost_complete": llmCost.calls_by_basis.unavailable === 0,
              "assess.assessed": out.filter((p) => p.assessment.status === "assessed").length,
              "assess.failed": out.filter((p) => p.assessment.status === "failed").length,
              "assess.not_assessed": out.filter((p) => p.assessment.status === "not_assessed").length,
            });
            return out;
          },
        ),
      );

      return finish("completed", filters, prospects);

      async function assessOne(
        prospect: Pick<BaselineProspect, "raw" | "enrichment">,
      ): Promise<{ assessment: AssessmentOutcome; llm_call: LlmCallRecord }> {
        const messages = buildAssessmentMessages(input_description, criteria, icp, prospect);
        // CHAIN, not LLM: a wrapOpenAI client records the LLM span itself, so
        // this span is the agent's step around it. The prompt and completion
        // are only captured here when the client does not record them.
        const recordsLlm = deps.llm.records_llm_spans;
        return tracer.span(
          {
            name: "assess_company",
            kind: "CHAIN",
            input: recordsLlm
              ? { company_id: prospect.raw.crustdata_company_id, enrichment_status: prospect.enrichment.status }
              : messages,
            attributes: {
              "company.id": prospect.raw.crustdata_company_id,
              "company.enrichment_status": prospect.enrichment.status,
              "llm.model": config.model,
              "llm.temperature": LLM_TEMPERATURE,
              "llm.max_output_tokens": config.max_output_tokens_per_call,
            },
          },
          async (span) => {
            recorder.counts.llm_calls += 1;
            const call_number = recorder.counts.llm_calls;
            let response: LlmResponse;
            try {
              response = await deps.llm.complete({
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
            recordCall(llm_call);
            llm_call.retry_waits_ms.forEach((wait_ms, i) =>
              span.addEvent("llm_retry", { "llm.retry": i + 1, "llm.retry_wait_ms": wait_ms }),
            );
            span.setAttributes(callAttributes(llm_call));

            if (!response.ok) {
              span.setAttributes({
                "assess.outcome": "llm_error",
                "llm.error_category": response.error.category,
              });
              return {
                llm_call,
                assessment: {
                  status: "failed",
                  reason: "llm_error",
                  message: response.error.message,
                  error_category: response.error.category,
                },
              };
            }
            span.setAttributes({ "llm.truncated": response.truncated });
            if (!recordsLlm) span.setAttributes({ "llm.output": response.text });

            if (response.truncated) {
              span.setAttributes({ "assess.outcome": "truncated" });
              return {
                llm_call,
                assessment: {
                  status: "failed",
                  reason: "truncated",
                  message: `Model output hit the ${config.max_output_tokens_per_call}-token limit.`,
                },
              };
            }
            const parsed = parseAssessment(response.text);
            span.setAttributes({ "assess.outcome": parsed.ok ? "assessed" : "malformed_output" });
            return {
              llm_call,
              assessment: parsed.ok
                ? { status: "assessed", assessment: parsed.assessment }
                : { status: "failed", reason: "malformed_output", message: parsed.message },
            };
          },
        );
      }

      function recordCall(call: LlmCallRecord): void {
        llmHttpAttempts += call.attempts;
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
    },
  );
}
