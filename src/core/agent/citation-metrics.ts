// Citation metrics for a baseline run. The baseline cites fact ids without
// ever building facts; this re-runs the improved pipeline's own evidence
// layer (validateCompanies + buildFacts) over the same records the baseline
// result holds and checks each cited id against it. Returns counts and
// company ids only, never records.

import { buildFacts } from "../data/facts";
import { validateCompanies } from "../data/validation";
import { type AnyFact, CITEABLE_FACT_STATUSES } from "../types";
import type {
  BaselineCitationMetrics,
  BaselineProspect,
  FactProvenance,
  PipelineResult,
} from "./types";

type CitationClass = "citeable" | "missing" | "model_provider" | "uncertain" | "other_non_citeable";

// Company id named by a fact id of the form "<company_id>:<field>".
function companyIdOf(factId: string): number | undefined {
  const prefix = /^(\d+):/.exec(factId)?.[1];
  return prefix === undefined ? undefined : Number(prefix);
}

// Classifies every outreach citation in `prospects` against `facts`, which
// is index-aligned with them (facts[i] are prospect i's facts). Checks run
// in order: missing, model_provider, uncertain, other_non_citeable;
// anything else is citeable (status in CITEABLE_FACT_STATUSES, provider not
// "model", and the fact belongs to that company).
export function classifyCitations(
  prospects: readonly BaselineProspect[],
  facts: readonly (readonly AnyFact[])[],
  fact_provider: FactProvenance,
): BaselineCitationMetrics {
  const counts: Record<CitationClass, number> = {
    citeable: 0,
    missing: 0,
    model_provider: 0,
    uncertain: 0,
    other_non_citeable: 0,
  };
  let assessed = 0;
  let drafts = 0;
  let cited = 0;
  let crossCompany = 0;
  const violatingIds: number[] = [];

  // Which company each known fact id belongs to.
  const owner = new Map<string, number>();
  prospects.forEach((p, i) => {
    for (const f of facts[i] ?? []) owner.set(f.id, p.raw.crustdata_company_id);
  });

  prospects.forEach((p, i) => {
    if (p.assessment.status !== "assessed") return;
    assessed += 1;
    const outreach = p.assessment.assessment.outreach;
    if (!outreach) return;
    drafts += 1;
    const companyId = p.raw.crustdata_company_id;
    const byId = new Map((facts[i] ?? []).map((f) => [f.id, f]));
    let violated = false;
    for (const id of new Set(outreach.cited_fact_ids)) {
      cited += 1;
      const fact = byId.get(id);
      let kind: CitationClass;
      if (!fact) {
        kind = "missing";
        const named = owner.get(id) ?? companyIdOf(id);
        if (named !== undefined && named !== companyId) crossCompany += 1;
      } else if (fact.source.provider === "model") {
        kind = "model_provider";
      } else if (fact.status === "uncertain") {
        kind = "uncertain";
      } else if (!CITEABLE_FACT_STATUSES.includes(fact.status)) {
        kind = "other_non_citeable";
      } else {
        kind = "citeable";
      }
      counts[kind] += 1;
      if (kind !== "citeable") violated = true;
    }
    if (violated) violatingIds.push(companyId);
  });

  return {
    fact_provider,
    prospects: prospects.length,
    assessed,
    outreach_drafts: drafts,
    cited_fact_ids: cited,
    ...counts,
    cross_company: crossCompany,
    drafts_with_violations: { count: violatingIds.length, company_ids: violatingIds },
  };
}

// Measures a baseline result's outreach citations with validateCompanies()
// and buildFacts() over that result's own records (enriched where the
// baseline enriched, search records otherwise), in result order.
// fact_provider must be stated: it is never guessed.
export function computeBaselineCitationMetrics(
  result: PipelineResult,
  fact_provider: FactProvenance,
): BaselineCitationMetrics {
  if (fact_provider !== "fixture" && fact_provider !== "crustdata") {
    throw new TypeError('computeBaselineCitationMetrics needs fact_provider "fixture" or "crustdata".');
  }
  const records = result.prospects.map((p) => p.raw);
  const validations = validateCompanies(records);
  const facts = records.map((r, i) => buildFacts(r, validations[i], fact_provider));
  return classifyCitations(result.prospects, facts, fact_provider);
}
