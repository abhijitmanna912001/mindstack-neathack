// Improved pipeline: plan -> search -> validate_companies -> deduplicate ->
// enrich (eligible, unique companies only) -> validate_companies again on the
// enriched records -> build_facts -> assess from facts only ->
// validate_assessment -> check_claims.
//
// Same options and PipelineResult as runBaselinePipeline, so a runner can
// switch between them; its deps additionally require fact_provider.
// Planning, search, enrichment mechanics, model calls, caps, retries and cost
// accounting are the shared ones in run-context.ts; validation and facts are
// the data layer's own functions. No network of its own, and no tracing
// setup, flush or shutdown.

import { buildFacts } from "../data/facts";
import { validateCompanies } from "../data/validation";
import type { AnyFact, RawCompany, Validation } from "../types";
import { checkClaims, isCiteableFact, validateAssessment } from "./assessment-checks";
import { buildFactsMessages, expectedCriteria } from "./facts-prompt";
import type { LlmErrorCategory } from "./llm";
import { LLM_TEMPERATURE } from "./llm-policy";
import { PipelineRun, stopCategory } from "./run-context";
import type { TraceAttributes } from "./tracer";
import type {
  AssessmentChecks,
  AssessmentOutcome,
  BaselineProspect,
  CheckResult,
  EnrichmentOutcome,
  FactProvenance,
  IcpInput,
  IdCount,
  ImprovedPipelineDeps,
  ImprovedRunMetrics,
  LlmCallRecord,
  PipelineOptions,
  PipelineResult,
} from "./types";

function isDuplicate(validation: Validation): boolean {
  return (
    validation.status === "rejected" &&
    validation.issues.some((issue) => issue.code === "duplicate_domain")
  );
}

// Attributes for a validate_companies span: counts and company ids per
// verdict, never the records themselves.
function validationAttributes(
  ids: readonly number[],
  validations: readonly Validation[],
  phase: "search" | "enriched",
): TraceAttributes {
  const idsWith = (status: Validation["status"]) =>
    ids.filter((_, i) => validations[i].status === status);
  return {
    "validation.phase": phase,
    "validation.valid_count": idsWith("valid").length,
    "validation.flagged_count": idsWith("flagged").length,
    "validation.rejected_count": idsWith("rejected").length,
    "validation.flagged_ids": idsWith("flagged"),
    "validation.rejected_ids": idsWith("rejected"),
    "validation.duplicate_ids": ids.filter((_, i) => isDuplicate(validations[i])),
    "validation.issue_codes": [
      ...new Set(validations.flatMap((v) => v.issues.map((i) => i.code))),
    ].sort(),
  };
}

// Attributes shared by the validate_assessment and check_claims spans.
function findingAttributes(company_id: number, check: CheckResult): TraceAttributes {
  return {
    "company.id": company_id,
    "guardrail.ok": check.ok,
    "guardrail.error_count": check.findings.filter((f) => f.severity === "error").length,
    "guardrail.warning_count": check.findings.filter((f) => f.severity === "warning").length,
    "guardrail.finding_codes": check.findings.map((f) => f.code),
  };
}

const idsWhere = (prospects: readonly BaselineProspect[], test: (p: BaselineProspect) => boolean): IdCount => {
  const company_ids = prospects.filter(test).map((p) => p.raw.crustdata_company_id);
  return { count: company_ids.length, company_ids };
};

function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

// The run's guardrail outcomes as counts and company ids (no records).
function improvedMetrics(
  prospects: readonly BaselineProspect[],
  eligibleIds: readonly number[],
  requestedIds: readonly number[],
): ImprovedRunMetrics {
  const failed = prospects.filter((p) => p.assessment.status === "failed");
  const violations = prospects.flatMap((p) =>
    (p.checks?.claims?.findings ?? [])
      .filter((f) => f.severity === "error")
      .map((f) => ({ company_id: p.raw.crustdata_company_id, code: f.code })),
  );
  const violatingIds = [...new Set(violations.map((v) => v.company_id))];
  return {
    rejected: idsWhere(prospects, (p) => p.validation?.status === "rejected" && !isDuplicate(p.validation)),
    flagged: idsWhere(prospects, (p) => p.validation?.status === "flagged"),
    duplicates_removed: idsWhere(prospects, (p) => p.validation !== undefined && isDuplicate(p.validation)),
    enrichment: {
      eligible: { count: eligibleIds.length, company_ids: eligibleIds },
      requested: { count: requestedIds.length, company_ids: requestedIds },
      enriched: idsWhere(prospects, (p) => p.enrichment.status === "enriched"),
    },
    assessments_failed: {
      count: failed.length,
      company_ids: failed.map((p) => p.raw.crustdata_company_id),
      by_reason: tally(failed.map((p) => (p.assessment.status === "failed" ? p.assessment.reason : ""))),
    },
    outreach_suppressed: idsWhere(prospects, (p) => p.checks?.outreach === "removed"),
    claim_violations: {
      count: violations.length,
      drafts: violatingIds.length,
      by_code: tally(violations.map((v) => v.code)),
      company_ids: violatingIds,
    },
  };
}

export async function runImprovedPipeline(
  icp: IcpInput,
  deps: ImprovedPipelineDeps,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  // The type requires fact_provider; this also stops untyped callers, before
  // any provider or model call, instead of guessing the provenance.
  const factProvider: FactProvenance = deps.fact_provider;
  if (factProvider !== "fixture" && factProvider !== "crustdata") {
    throw new TypeError(
      'runImprovedPipeline needs deps.fact_provider set to "fixture" or "crustdata".',
    );
  }
  const run = new PipelineRun(icp, deps, options, "improved");
  const { config, tracer, recorder } = run;
  const criteria = expectedCriteria(run.criteria);

  return run.workflow("signalscout_improved_run", async (root) => {
    // 1. Plan and 2. search: identical to the baseline.
    const filters = await run.plan();
    const search = await run.search(filters);
    if (search.kind === "stopped") return run.finish(root, "stopped", filters, []);
    if (search.kind === "empty") return run.finish(root, "completed_empty", filters, []);
    const companies = search.companies;
    const ids = companies.map((c) => c.crustdata_company_id);

    // 3. Validate the search records.
    const searchValidations = await recorder.time("validate", () =>
      tracer.span(
        { name: "validate_companies", kind: "GUARDRAIL", input: { phase: "search", companies: ids } },
        async (span) => {
          const validations = validateCompanies(companies);
          span.setAttributes(validationAttributes(ids, validations, "search"));
          return validations;
        },
      ),
    );

    // 4. Deduplicate: rejected records, later duplicates included, leave the
    // enrichment candidates. validateCompanies() already decided which copy
    // of a duplicate is kept (the first one).
    const eligible = await recorder.time("validate", () =>
      tracer.span({ name: "deduplicate", kind: "GUARDRAIL", input: { companies: ids } }, async (span) => {
        const kept = companies.map((_, i) => i).filter((i) => searchValidations[i].status !== "rejected");
        span.setAttributes({
          "dedupe.duplicate_ids": ids.filter((_, i) => isDuplicate(searchValidations[i])),
          "dedupe.rejected_ids": ids.filter(
            (_, i) => searchValidations[i].status === "rejected" && !isDuplicate(searchValidations[i]),
          ),
          "dedupe.eligible_count": kept.length,
        });
        return kept;
      }),
    );

    // 5. Enrich eligible, unique companies in search order, within the cap.
    const enrich = await run.enrich(eligible.map((i) => companies[i]));
    const enrichment: EnrichmentOutcome[] = companies.map(() => ({ status: "skipped_ineligible" }));
    const enrichedRecords = new Map<number, RawCompany>();
    eligible.forEach((companyIndex, k) => {
      enrichment[companyIndex] = enrich.outcomes[k];
      const record = enrich.enriched.get(k);
      if (record) enrichedRecords.set(companyIndex, record);
    });
    const records = companies.map((c, i) => enrichedRecords.get(i) ?? c);

    // 6. Revalidate: enrichment can add fields (headcount, revenue) that the
    // size rules need, so the verdict is re-run on the final records.
    const validations = await recorder.time("validate", () =>
      tracer.span(
        { name: "validate_companies", kind: "GUARDRAIL", input: { phase: "enriched", companies: ids } },
        async (span) => {
          const result = validateCompanies(records);
          span.setAttributes({
            ...validationAttributes(ids, result, "enriched"),
            "validation.changed_ids": ids.filter(
              (_, i) => JSON.stringify(result[i]) !== JSON.stringify(searchValidations[i]),
            ),
          });
          return result;
        },
      ),
    );

    // 7. Build facts from the final records and verdicts.
    const facts = await recorder.time("validate", () =>
      tracer.span({ name: "build_facts", kind: "GUARDRAIL", input: { companies: ids } }, async (span) => {
        const built = records.map((r, i) => buildFacts(r, validations[i], factProvider));
        const all = built.flat();
        span.setAttributes({
          "facts.provider": factProvider,
          "facts.total": all.length,
          "facts.citeable": all.filter(isCiteableFact).length,
          "facts.uncertain": all.filter((f) => f.status === "uncertain").length,
          "facts.cross_checked": all.filter((f) => f.status === "cross_checked").length,
          "facts.company_ids": ids.filter((_, i) => built[i].length > 0),
          "facts.empty_company_ids": ids.filter((_, i) => built[i].length === 0),
        });
        return built;
      }),
    );

    // 8. Assess only enriched, non-rejected companies, one at a time, within
    // the model-call cap; then 9. validateAssessment and 10. checkClaims.
    const prospects = await recorder.time("assess", () =>
      tracer.span(
        { name: "assess", kind: "AGENT", input: { companies: companies.length, criteria } },
        async (span) => {
          const out: BaselineProspect[] = [];
          let capReached = false;
          let stoppedBy: LlmErrorCategory | undefined;
          for (let i = 0; i < companies.length; i++) {
            const base = {
              raw: records[i],
              enrichment: enrichment[i],
              search_validation: searchValidations[i],
              validation: validations[i],
              facts: facts[i],
            };
            if (validations[i].status === "rejected") {
              const reason = isDuplicate(validations[i]) ? "duplicate" : "rejected";
              out.push({ ...base, assessment: { status: "not_assessed", reason } });
              continue;
            }
            if (enrichment[i].status !== "enriched") {
              out.push({ ...base, assessment: { status: "not_assessed", reason: "not_enriched" } });
              continue;
            }
            if (stoppedBy) {
              out.push({ ...base, assessment: { status: "not_assessed", reason: "llm_stopped" } });
              continue;
            }
            if (!run.canCallModel()) {
              capReached = true;
              out.push({ ...base, assessment: { status: "not_assessed", reason: "llm_call_cap" } });
              continue;
            }
            const assessed = await assessOne(records[i], enrichment[i], validations[i], facts[i]);
            out.push({ ...base, ...assessed });
            stoppedBy = stopCategory(assessed.assessment);
          }
          run.addAssessIssues(stoppedBy, capReached);
          span.setAttributes({
            ...run.assessAttributes(out),
            "guardrail.invalid_assessments": out.filter(
              (p) => p.assessment.status === "failed" && p.assessment.reason === "invalid_assessment",
            ).length,
            "guardrail.outreach_kept": out.filter((p) => p.checks?.outreach === "kept").length,
            "guardrail.outreach_removed": out.filter((p) => p.checks?.outreach === "removed").length,
          });
          return out;
        },
      ),
    );

    // Rejected records stay in the result but are not delivered prospects.
    const delivered = prospects.filter((p) => p.validation?.status !== "rejected").length;
    const metrics = improvedMetrics(
      prospects,
      eligible.map((i) => ids[i]),
      enrich.requested_indices.map((k) => ids[eligible[k]]),
    );
    root.setAttributes({
      "improved.rejected_count": metrics.rejected.count,
      "improved.flagged_count": metrics.flagged.count,
      "improved.duplicates_removed": metrics.duplicates_removed.count,
      "improved.enrichment_eligible": metrics.enrichment.eligible.count,
      "improved.enrichment_requested": metrics.enrichment.requested.count,
      "improved.assessments_failed": metrics.assessments_failed.count,
      "improved.outreach_suppressed": metrics.outreach_suppressed.count,
      "improved.claim_violations": metrics.claim_violations.count,
    });
    return run.finish(root, "completed", filters, prospects, delivered, metrics);

    async function assessOne(
      raw: RawCompany,
      enrichmentOutcome: EnrichmentOutcome,
      validation: Validation,
      companyFacts: readonly AnyFact[],
    ): Promise<{ assessment: AssessmentOutcome; llm_call: LlmCallRecord; checks?: AssessmentChecks }> {
      const messages = buildFactsMessages({
        icp_description: run.input_description,
        criteria,
        excluded_domains: icp.excluded_domains,
        company_id: raw.crustdata_company_id,
        facts: companyFacts,
      });
      // CHAIN, not LLM: a wrapOpenAI client records the LLM span itself.
      const recordsLlm = deps.llm.records_llm_spans;
      return tracer.span(
        {
          name: "assess_company",
          kind: "CHAIN",
          input: recordsLlm
            ? {
                company_id: raw.crustdata_company_id,
                enrichment_status: enrichmentOutcome.status,
                fact_ids: companyFacts.map((f) => f.id),
              }
            : messages,
          attributes: {
            "company.id": raw.crustdata_company_id,
            "company.enrichment_status": enrichmentOutcome.status,
            "company.validation_status": validation.status,
            "company.fact_count": companyFacts.length,
            "company.citeable_fact_count": companyFacts.filter(isCiteableFact).length,
            "llm.model": config.model,
            "llm.temperature": LLM_TEMPERATURE,
            "llm.max_output_tokens": config.max_output_tokens_per_call,
          },
        },
        async (span) => {
          const { response, llm_call } = await run.callModel(messages, span);
          const parsed = run.parseResponse(response, span);
          if (!parsed.ok) return { assessment: parsed.outcome, llm_call };

          const assessmentCheck = await tracer.span(
            { name: "validate_assessment", kind: "GUARDRAIL", input: { company_id: raw.crustdata_company_id } },
            async (guard) => {
              const check = validateAssessment(parsed.assessment, companyFacts, criteria);
              guard.setAttributes({
                ...findingAttributes(raw.crustdata_company_id, check),
                "assessment.criteria_expected": criteria.length,
                "assessment.criteria_scored": parsed.assessment.criterion_scores.length,
                "assessment.referenced_fact_ids": [
                  ...new Set(parsed.assessment.criterion_scores.flatMap((s) => s.fact_ids)),
                ],
              });
              return check;
            },
          );
          if (!assessmentCheck.ok) {
            span.setAttributes({ "assess.outcome": "invalid_assessment" });
            const errors = assessmentCheck.findings.filter((f) => f.severity === "error");
            return {
              llm_call,
              assessment: {
                status: "failed",
                reason: "invalid_assessment",
                message: errors.map((f) => f.message).join(" "),
              },
              checks: { assessment: assessmentCheck, outreach: "none" },
            };
          }

          const outreach = parsed.assessment.outreach;
          if (!outreach) {
            span.setAttributes({ "assess.outreach": "none" });
            return {
              llm_call,
              assessment: { status: "assessed", assessment: parsed.assessment },
              checks: { assessment: assessmentCheck, outreach: "none" },
            };
          }

          const claims = await tracer.span(
            { name: "check_claims", kind: "GUARDRAIL", input: { company_id: raw.crustdata_company_id } },
            async (guard) => {
              const check = checkClaims(outreach, companyFacts);
              guard.setAttributes({
                ...findingAttributes(raw.crustdata_company_id, check),
                "claims.cited_fact_ids": [...new Set(outreach.cited_fact_ids)],
                "claims.violating_fact_ids": [
                  ...new Set(
                    check.findings.flatMap((f) => (f.severity === "error" && f.fact_id ? [f.fact_id] : [])),
                  ),
                ],
                "claims.outcome": check.ok ? "kept" : "removed",
              });
              return check;
            },
          );
          span.setAttributes({ "assess.outreach": claims.ok ? "kept" : "removed" });
          // Outreach that fails the claim check is dropped; the scores stand.
          const assessment = claims.ok
            ? parsed.assessment
            : {
                fit_score: parsed.assessment.fit_score,
                criterion_scores: parsed.assessment.criterion_scores,
                uncertainty_notes: parsed.assessment.uncertainty_notes,
              };
          return {
            llm_call,
            assessment: { status: "assessed", assessment },
            checks: { assessment: assessmentCheck, claims, outreach: claims.ok ? "kept" : "removed" },
          };
        },
      );
    }
  });
}
