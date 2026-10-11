// Naive baseline pipeline: plan -> search -> enrich -> assess. It deliberately
// skips validation, deduplication, buildFacts(), validateAssessment() and
// checkClaims(), so its trace shows what the unguarded agent does.
// No network of its own: data comes from the CompanyProvider and model output
// from the LlmClient passed in.

import { buildAssessmentMessages } from "./assess";
import type { LlmErrorCategory } from "./llm";
import { LLM_TEMPERATURE } from "./llm-policy";
import { PipelineRun, stopCategory } from "./run-context";
import type {
  AssessmentOutcome,
  BaselineProspect,
  IcpInput,
  LlmCallRecord,
  PipelineDeps,
  PipelineOptions,
  PipelineResult,
} from "./types";

export async function runBaselinePipeline(
  icp: IcpInput,
  deps: PipelineDeps,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const run = new PipelineRun(icp, deps, options, "naive_baseline");
  const assessScope = options.assess ?? "all_searched";
  const { config, tracer, recorder } = run;

  return run.workflow("signalscout_baseline_run", async (root) => {
    // 1. Plan: ICP -> SearchFilters (free industry autocomplete).
    const filters = await run.plan();

    // 2. Search.
    const search = await run.search(filters);
    if (search.kind === "stopped") return run.finish(root, "stopped", filters, []);
    if (search.kind === "empty") return run.finish(root, "completed_empty", filters, []);
    const companies = search.companies;

    // 3. Enrich in search order, within the remaining enrichment budget.
    const enrich = await run.enrich(companies);
    const pending = companies.map((company, i) => ({
      raw: enrich.enriched.get(i) ?? company,
      enrichment: enrich.outcomes[i],
    }));

    // 4. Assess, one company at a time, within the model-call cap.
    const prospects = await recorder.time("assess", () =>
      tracer.span(
        { name: "assess", kind: "AGENT", input: { companies: pending.length, criteria: run.criteria } },
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
            if (!run.canCallModel()) {
              capReached = true;
              out.push({ ...prospect, assessment: { status: "not_assessed", reason: "llm_call_cap" } });
              continue;
            }
            const { assessment, llm_call } = await assessOne(prospect);
            out.push({ ...prospect, assessment, llm_call });
            stoppedBy = stopCategory(assessment);
          }
          run.addAssessIssues(stoppedBy, capReached);
          span.setAttributes(run.assessAttributes(out));
          return out;
        },
      ),
    );

    return run.finish(root, "completed", filters, prospects);

    async function assessOne(
      prospect: Pick<BaselineProspect, "raw" | "enrichment">,
    ): Promise<{ assessment: AssessmentOutcome; llm_call: LlmCallRecord }> {
      const messages = buildAssessmentMessages(run.input_description, run.criteria, icp, prospect);
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
          const { response, llm_call } = await run.callModel(messages, span);
          const parsed = run.parseResponse(response, span);
          return {
            llm_call,
            assessment: parsed.ok ? { status: "assessed", assessment: parsed.assessment } : parsed.outcome,
          };
        },
      );
    }
  });
}
