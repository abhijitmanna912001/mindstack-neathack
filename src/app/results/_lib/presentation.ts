// Presentation DTO for the results page. Built field by field from the
// improved pipeline's result: no raw company record, source-record detail,
// prompt, model output metadata, trace data or credential reaches it, and
// nothing is spread from pipeline objects. Plain JSON throughout.

import { isCiteableFact } from "../../../core/agent/assessment-checks";
import type {
  AssessmentOutcome,
  BaselineProspect,
  CheckFinding,
  EnrichmentStatus,
  IdCount,
  ImprovedRunMetrics,
  PipelineResult,
  PipelineStatus,
} from "../../../core/agent/types";
import type { FactProvider, FactStatus, ValidationStatus } from "../../../core/types";
import { SYNTHETIC_MODE } from "./mode";

export interface IdCountDto {
  readonly count: number;
  readonly company_ids: readonly number[];
}

export interface FindingDto {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly fact_id?: string;
  readonly criterion?: string;
}

export interface FactDto {
  readonly id: string;
  readonly claim: string;
  readonly status: FactStatus;
  readonly provider: FactProvider;
  readonly citeable: boolean;
}

export type AssessmentDto =
  | {
      readonly status: "assessed";
      readonly fit_score: number;
      readonly criterion_scores: readonly {
        readonly criterion: string;
        readonly score: number;
        readonly fact_ids: readonly string[];
      }[];
      readonly uncertainty_notes: readonly string[];
    }
  | { readonly status: "failed"; readonly reason: string; readonly message: string }
  | { readonly status: "not_assessed"; readonly reason: string };

export type OutreachDto =
  | { readonly state: "kept"; readonly body: string; readonly cited_fact_ids: readonly string[] }
  // The pipeline removed the draft; only the findings that caused it remain.
  | { readonly state: "suppressed"; readonly findings: readonly FindingDto[] }
  | { readonly state: "none" };

export interface ProspectDto {
  readonly company_id: number;
  readonly display_name: string;
  readonly search_validation_status: ValidationStatus | null;
  readonly validation: {
    readonly status: ValidationStatus | null;
    readonly issues: readonly {
      readonly code: string;
      readonly field: string;
      readonly reason: string;
      readonly related_company_id?: number;
    }[];
  };
  readonly enrichment_status: EnrichmentStatus;
  readonly assessment: AssessmentDto;
  readonly facts: readonly FactDto[];
  readonly outreach: OutreachDto;
  readonly guard: {
    readonly assessment_findings: readonly FindingDto[];
    readonly claim_findings: readonly FindingDto[];
  };
}

export interface MetricsDto {
  readonly rejected: IdCountDto;
  readonly flagged: IdCountDto;
  readonly duplicates_removed: IdCountDto;
  readonly enrichment_eligible: IdCountDto;
  readonly enrichment_requested: IdCountDto;
  readonly enrichment_enriched: IdCountDto;
  readonly assessments_failed: IdCountDto;
  readonly assessments_failed_by_reason: readonly { readonly reason: string; readonly count: number }[];
  readonly outreach_suppressed: IdCountDto;
  readonly claim_violations: number;
  readonly claim_violation_drafts: number;
  readonly claim_violations_by_code: readonly { readonly code: string; readonly count: number }[];
}

export interface ResultsDto {
  readonly mode: typeof SYNTHETIC_MODE;
  readonly run: {
    readonly status: PipelineStatus;
    readonly fact_provider: "fixture";
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
    // Nothing external is called in synthetic mode.
    readonly actual_spend_usd: 0;
    // FixtureProvider's simulated per-record prices; never a real charge.
    readonly simulated_provider_cost_usd: {
      readonly search: number;
      readonly enrich: number;
      readonly total: number;
    };
  };
  readonly metrics: MetricsDto | null;
  readonly issues: readonly { readonly code: string; readonly message: string }[];
  readonly prospects: readonly ProspectDto[];
}

const MAX_NAME_LENGTH = 80;

function idCount(value: IdCount): IdCountDto {
  return { count: value.count, company_ids: [...value.company_ids] };
}

function entries<K extends string>(record: Readonly<Record<string, number>>, key: K) {
  return Object.keys(record)
    .sort()
    .map((name) => ({ [key]: name, count: record[name] }) as { [P in K]: string } & { count: number });
}

function finding(f: CheckFinding): FindingDto {
  return {
    code: f.code,
    severity: f.severity,
    message: f.message,
    ...(f.fact_id !== undefined ? { fact_id: f.fact_id } : {}),
    ...(f.criterion !== undefined ? { criterion: f.criterion } : {}),
  };
}

function displayName(name: string, companyId: number): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean === "") return `Company ${companyId}`;
  return clean.length > MAX_NAME_LENGTH ? `${clean.slice(0, MAX_NAME_LENGTH - 1)}…` : clean;
}

function assessmentDto(outcome: AssessmentOutcome): AssessmentDto {
  switch (outcome.status) {
    case "assessed":
      return {
        status: "assessed",
        fit_score: outcome.assessment.fit_score,
        criterion_scores: outcome.assessment.criterion_scores.map((s) => ({
          criterion: s.criterion,
          score: s.score,
          fact_ids: [...s.fact_ids],
        })),
        uncertainty_notes: [...outcome.assessment.uncertainty_notes],
      };
    case "failed":
      return { status: "failed", reason: outcome.reason, message: outcome.message };
    case "not_assessed":
      return { status: "not_assessed", reason: outcome.reason };
  }
}

function outreachDto(p: BaselineProspect): OutreachDto {
  if (p.checks?.outreach === "removed") {
    return {
      state: "suppressed",
      findings: (p.checks.claims?.findings ?? []).filter((f) => f.severity === "error").map(finding),
    };
  }
  if (p.assessment.status === "assessed" && p.assessment.assessment.outreach) {
    const { body, cited_fact_ids } = p.assessment.assessment.outreach;
    return { state: "kept", body, cited_fact_ids: [...cited_fact_ids] };
  }
  return { state: "none" };
}

export function toProspectDto(p: BaselineProspect): ProspectDto {
  const companyId = p.raw.crustdata_company_id;
  const validation = p.validation ?? p.search_validation;
  return {
    company_id: companyId,
    display_name: displayName(p.raw.name, companyId),
    search_validation_status: p.search_validation?.status ?? null,
    validation: {
      status: validation?.status ?? null,
      issues: (validation?.issues ?? []).map((issue) => ({
        code: issue.code,
        field: issue.field,
        reason: issue.reason,
        ...(issue.related_company_id !== undefined ? { related_company_id: issue.related_company_id } : {}),
      })),
    },
    enrichment_status: p.enrichment.status,
    assessment: assessmentDto(p.assessment),
    facts: (p.facts ?? []).map((f) => ({
      id: f.id,
      claim: f.claim,
      status: f.status,
      provider: f.source.provider,
      citeable: isCiteableFact(f),
    })),
    outreach: outreachDto(p),
    guard: {
      assessment_findings: (p.checks?.assessment.findings ?? []).map(finding),
      claim_findings: (p.checks?.claims?.findings ?? []).map(finding),
    },
  };
}

export function metricsDto(m: ImprovedRunMetrics): MetricsDto {
  return {
    rejected: idCount(m.rejected),
    flagged: idCount(m.flagged),
    duplicates_removed: idCount(m.duplicates_removed),
    enrichment_eligible: idCount(m.enrichment.eligible),
    enrichment_requested: idCount(m.enrichment.requested),
    enrichment_enriched: idCount(m.enrichment.enriched),
    assessments_failed: idCount(m.assessments_failed),
    assessments_failed_by_reason: entries(m.assessments_failed.by_reason, "reason"),
    outreach_suppressed: idCount(m.outreach_suppressed),
    claim_violations: m.claim_violations.count,
    claim_violation_drafts: m.claim_violations.drafts,
    claim_violations_by_code: entries(m.claim_violations.by_code, "code"),
  };
}

export function toResultsDto(result: PipelineResult): ResultsDto {
  const costs = result.run.cost_usd_by_step;
  return {
    mode: SYNTHETIC_MODE,
    run: {
      status: result.status,
      fact_provider: "fixture",
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
      actual_spend_usd: 0,
      simulated_provider_cost_usd: {
        search: costs.search,
        enrich: costs.enrich,
        total: result.usage.provider.cost_usd,
      },
    },
    metrics: result.metrics ? metricsDto(result.metrics) : null,
    issues: result.issues.map((i) => ({ code: i.code, message: i.message })),
    prospects: result.prospects.map(toProspectDto),
  };
}
