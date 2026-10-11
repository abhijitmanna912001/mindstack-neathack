// Deterministic guardrails on model output, run by the improved pipeline.
// validateAssessment() checks scores and fact references; checkClaims()
// checks that outreach rests only on citeable facts. Neither calls a model,
// and neither changes a fact's status.

import { type AnyFact, type Assessment, CITEABLE_FACT_STATUSES, type OutreachDraft } from "../types";
import type { CheckFinding, CheckResult } from "./types";

// Shared rule (see OutreachDraft in src/core/types.ts): a fact may be cited
// only when its status is citeable and it did not come from the model.
export function isCiteableFact(fact: AnyFact): boolean {
  return CITEABLE_FACT_STATUSES.includes(fact.status) && fact.source.provider !== "model";
}

function normaliseCriterion(name: string): string {
  return name.trim().toLowerCase();
}

function inScoreRange(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

function result(findings: CheckFinding[]): CheckResult {
  return { ok: findings.every((f) => f.severity !== "error"), findings };
}

// Checks one company's assessment against the criteria it was asked to score
// and the facts that exist for that company.
// - fit_score and every criterion score must be in 0..100.
// - Each expected criterion must be scored exactly once (case-insensitive),
//   and nothing else may be scored.
// - Every referenced fact id must exist for this company. Referencing an
//   uncertain fact is allowed in a score (it can explain a low score) but is
//   recorded as a warning.
export function validateAssessment(
  assessment: Assessment,
  facts: readonly AnyFact[],
  expected_criteria: readonly string[],
): CheckResult {
  const findings: CheckFinding[] = [];
  const byId = new Map(facts.map((f) => [f.id, f]));

  if (!inScoreRange(assessment.fit_score)) {
    findings.push({
      code: "fit_score_out_of_range",
      severity: "error",
      message: `fit_score ${assessment.fit_score} is outside 0-100.`,
    });
  }

  const expected = new Map(expected_criteria.map((c) => [normaliseCriterion(c), c]));
  const seen = new Set<string>();
  for (const score of assessment.criterion_scores) {
    const key = normaliseCriterion(score.criterion);
    if (!expected.has(key)) {
      findings.push({
        code: "unexpected_criterion",
        severity: "error",
        message: `"${score.criterion}" is not one of the requested criteria.`,
        criterion: score.criterion,
      });
    } else if (seen.has(key)) {
      findings.push({
        code: "duplicate_criterion",
        severity: "error",
        message: `"${score.criterion}" is scored more than once.`,
        criterion: score.criterion,
      });
    }
    seen.add(key);

    if (!inScoreRange(score.score)) {
      findings.push({
        code: "criterion_score_out_of_range",
        severity: "error",
        message: `Score ${score.score} for "${score.criterion}" is outside 0-100.`,
        criterion: score.criterion,
      });
    }

    for (const id of score.fact_ids) {
      const fact = byId.get(id);
      if (!fact) {
        findings.push({
          code: "unknown_fact_reference",
          severity: "error",
          message: `"${score.criterion}" references ${id}, which is not a fact for this company.`,
          fact_id: id,
          criterion: score.criterion,
        });
      } else if (fact.status === "uncertain") {
        findings.push({
          code: "uncertain_fact_reference",
          severity: "warning",
          message: `"${score.criterion}" references ${id}, which is uncertain.`,
          fact_id: id,
          criterion: score.criterion,
        });
      }
    }
  }

  for (const [key, original] of expected) {
    if (!seen.has(key)) {
      findings.push({
        code: "missing_criterion",
        severity: "error",
        message: `"${original}" was not scored.`,
        criterion: original,
      });
    }
  }

  return result(findings);
}

// Numbers as written in text: "1,200" -> "1200", "2.5" stays, trailing
// punctuation dropped.
function numberTokens(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((t) => t.replace(/,/g, ""));
}

// Checks an outreach draft against the company's facts.
// - It must cite at least one fact.
// - Every cited id must exist for this company, have a citeable status, and
//   not come from the model.
// - Every number in the body must appear in a citeable fact it cites, so an
//   unknown figure cannot be stated as established.
export function checkClaims(outreach: OutreachDraft, facts: readonly AnyFact[]): CheckResult {
  const findings: CheckFinding[] = [];
  const byId = new Map(facts.map((f) => [f.id, f]));

  if (outreach.cited_fact_ids.length === 0) {
    findings.push({
      code: "no_citations",
      severity: "error",
      message: "The outreach cites no facts.",
    });
  }

  const supporting: AnyFact[] = [];
  const seen = new Set<string>();
  for (const id of outreach.cited_fact_ids) {
    if (seen.has(id)) {
      findings.push({
        code: "duplicate_citation",
        severity: "warning",
        message: `${id} is cited more than once.`,
        fact_id: id,
      });
      continue;
    }
    seen.add(id);
    const fact = byId.get(id);
    if (!fact) {
      findings.push({
        code: "unknown_citation",
        severity: "error",
        message: `${id} is not a fact for this company.`,
        fact_id: id,
      });
    } else if (fact.source.provider === "model") {
      findings.push({
        code: "model_fact_citation",
        severity: "error",
        message: `${id} came from the model and cannot be cited.`,
        fact_id: id,
      });
    } else if (!isCiteableFact(fact)) {
      findings.push({
        code: "non_citeable_citation",
        severity: "error",
        message: `${id} has status "${fact.status}", which cannot be cited.`,
        fact_id: id,
      });
    } else {
      supporting.push(fact);
    }
  }

  const supportedNumbers = new Set(
    supporting.flatMap((f) => [...numberTokens(f.claim), ...numberTokens(String(f.value))]),
  );
  for (const n of new Set(numberTokens(outreach.body))) {
    if (!supportedNumbers.has(n)) {
      findings.push({
        code: "unsupported_number",
        severity: "error",
        message: `The outreach states "${n}", which no cited citeable fact supports.`,
      });
    }
  }

  return result(findings);
}
