// LiveResultsDto mapping in both modes: labels, costs and their bases, and
// safe, code-based text. The pipeline result comes from the synthetic run;
// live-mode DTOs here exist only to exercise the mapping.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LlmCostSummary, PipelineResult } from "../../../core/agent/types";
import { toResultsDto } from "../../results/_lib/presentation";
import { runSyntheticPipeline } from "../../results/_lib/synthetic-run";
import { type LiveResultsDto, modelCost, SYNTHETIC_MODEL_COST, toLiveResultsDto } from "../_lib/live-results";
import {
  GENERIC_ISSUE_MESSAGE,
  GENERIC_VALIDATION_REASON,
  UNKNOWN_CODE,
} from "../_lib/safe-text";

let base: PipelineResult;
beforeAll(async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
  const run = await runSyntheticPipeline("synthetic");
  if (run.kind !== "ok") throw new Error("expected a synthetic run");
  base = run.result;
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const synthetic = (r: PipelineResult) => toLiveResultsDto(r, { mode: "synthetic", model: "fake" });
const live = (r: PipelineResult) => toLiveResultsDto(r, { mode: "live", model: "claude-haiku" });

function withCost(r: PipelineResult, llm_cost: Partial<LlmCostSummary>, llmCalls?: number): PipelineResult {
  return {
    ...r,
    run: llmCalls === undefined ? r.run : { ...r.run, counts: { ...r.run.counts, llm_calls: llmCalls } },
    usage: { ...r.usage, llm_cost: { ...r.usage.llm_cost, ...llm_cost } },
  };
}

describe("source, provenance and model labels", () => {
  it("labels a synthetic run as fixtures, fixture facts, simulated prices and the fake model", () => {
    const { run } = synthetic(base);
    expect(run.mode).toBe("synthetic");
    expect(run.data_source).toBe("fixtures");
    expect(run.fact_provider).toBe("fixture");
    expect(run.model).toBe("fake");
    expect(run.cost.provider_basis).toBe("simulated_fixture_prices");
  });

  it("labels a live run as Crustdata data, Crustdata facts, per-record estimates and the given model", () => {
    const { run } = live(base);
    expect(run.mode).toBe("live");
    expect(run.data_source).toBe("crustdata");
    expect(run.fact_provider).toBe("crustdata");
    expect(run.model).toBe("claude-haiku");
    expect(run.cost.provider_basis).toBe("estimated_per_record");
  });

  it("keeps a model name to plain identifier characters", () => {
    expect(toLiveResultsDto(base, { mode: "live", model: "  <b>claude</b>\n" }).run.model).toBe("b claude /b");
    expect(toLiveResultsDto(base, { mode: "live", model: "" }).run.model).toBe("unknown");
  });
});

describe("figures copied from the result", () => {
  it("keeps the run's status, limits, counts, metrics and prospects as the results page reports them", () => {
    const dto = synthetic(base);
    const existing = toResultsDto(base);
    expect(dto.run.status).toBe(existing.run.status);
    expect(dto.run.limits).toEqual(existing.run.limits);
    expect(dto.run.counts).toEqual(existing.run.counts);
    expect(dto.metrics).toEqual(existing.metrics);
    expect(dto.prospects.map((p) => p.company_id)).toEqual(existing.prospects.map((p) => p.company_id));
    expect(dto.prospects.map((p) => p.assessment.status)).toEqual(existing.prospects.map((p) => p.assessment.status));
    expect(dto.prospects.map((p) => p.facts)).toEqual(existing.prospects.map((p) => p.facts));
  });

  it("takes provider cost from usage.provider.cost_usd and model cost from llm_cost.known_usd", () => {
    const changed: PipelineResult = {
      ...withCost(base, { gateway_reported_usd: 0.5, estimated_usd: 0, known_usd: 0.5, calls_by_basis: { gateway_reported: 5, estimated: 0, unavailable: 0 }, complete: true }),
    };
    const withProvider: PipelineResult = {
      ...changed,
      usage: { ...changed.usage, provider: { ...changed.usage.provider, cost_usd: 1.2345 } },
    };
    const { cost } = live(withProvider).run;
    expect(cost.provider_usd).toBe(1.2345);
    expect(cost.model_usd).toBe(0.5);
    expect(cost.model_basis).toBe("gateway_reported");
    expect(cost.model_complete).toBe(true);
  });

  it("reports simulated provider prices but no external model cost in synthetic mode", () => {
    // FakeLlmClient makes logical calls with a simulated estimated cost; none
    // of it is an external model cost.
    expect(base.run.counts.llm_calls).toBeGreaterThan(0);
    expect(base.usage.llm_cost.calls_by_basis.estimated).toBeGreaterThan(0);
    expect(base.usage.llm_cost.known_usd).toBeGreaterThan(0);

    const { cost, counts } = synthetic(base).run;
    expect(cost.provider_usd).toBe(base.usage.provider.cost_usd);
    expect(cost).toMatchObject({ model_basis: "none", model_usd: 0, model_complete: true, model_calls_unavailable: 0 });
    expect(cost).toMatchObject(SYNTHETIC_MODEL_COST);
    // The fake-model calls stay counted.
    expect(counts.model_calls).toBe(base.run.counts.llm_calls);
  });

  it("leaves the existing ResultsDto unchanged", () => {
    const existing = toResultsDto(base);
    expect(existing.mode).toBe("synthetic");
    expect(existing.run.fact_provider).toBe("fixture");
    expect(existing.run.actual_spend_usd).toBe(0);
    expect("cost" in existing.run).toBe(false);
  });
});

describe("model cost basis", () => {
  const summary = (calls: { g?: number; e?: number; u?: number }, known: number, complete: boolean): LlmCostSummary => ({
    gateway_reported_usd: 0,
    estimated_usd: 0,
    known_usd: known,
    calls_by_basis: { gateway_reported: calls.g ?? 0, estimated: calls.e ?? 0, unavailable: calls.u ?? 0 },
    complete,
  });

  // Rules A to E.
  it.each([
    ["A: no model calls", summary({}, 0, true), 0, { model_basis: "none", model_usd: 0, model_complete: true, model_calls_unavailable: 0 }],
    ["B: gateway-reported only", summary({ g: 3 }, 0.012, true), 3, { model_basis: "gateway_reported", model_usd: 0.012, model_complete: true, model_calls_unavailable: 0 }],
    ["C: estimated only", summary({ e: 2 }, 0.004, true), 2, { model_basis: "estimated", model_usd: 0.004, model_complete: true, model_calls_unavailable: 0 }],
    ["D: gateway-reported and estimated", summary({ g: 2, e: 1 }, 0.01, true), 3, { model_basis: "mixed", model_usd: 0.01, model_complete: true, model_calls_unavailable: 0 }],
    ["E: all unavailable", summary({ u: 3 }, 0, false), 3, { model_basis: "unavailable", model_usd: 0, model_complete: false, model_calls_unavailable: 3 }],
  ] as const)("maps %s", (_name, cost, calls, expected) => {
    expect(modelCost(cost, calls)).toEqual(expected);
  });

  // Rule F: the basis describes the known costs only; completeness is separate.
  it.each([
    ["gateway-reported plus unavailable", summary({ g: 2, u: 1 }, 0.008, false), 3, "gateway_reported", 1],
    ["estimated plus unavailable", summary({ e: 3, u: 2 }, 0.003, false), 5, "estimated", 2],
    ["both known kinds plus unavailable", summary({ g: 1, e: 1, u: 2 }, 0.006, false), 4, "mixed", 2],
  ] as const)("maps F: %s by its known costs, incomplete", (_name, cost, calls, basis, unavailable) => {
    expect(modelCost(cost, calls)).toEqual({
      model_basis: basis,
      model_usd: cost.known_usd,
      model_complete: false,
      model_calls_unavailable: unavailable,
    });
  });

  it("keeps model_usd a number, even when every cost is unavailable", () => {
    const cost = modelCost(summary({ u: 3 }, 0, false), 3);
    expect(typeof cost.model_usd).toBe("number");
    expect(cost.model_usd).toBe(0);
  });

  it("counts calls the basis counts miss as unavailable", () => {
    // Four calls, none accounted for: never "no model calls".
    expect(modelCost(summary({}, 0, true), 4)).toEqual({
      model_basis: "unavailable",
      model_usd: 0,
      model_complete: false,
      model_calls_unavailable: 4,
    });
    // Five calls, three gateway-reported, two unaccounted for.
    expect(modelCost(summary({ g: 3 }, 0.009, true), 5)).toEqual({
      model_basis: "gateway_reported",
      model_usd: 0.009,
      model_complete: false,
      model_calls_unavailable: 2,
    });
    // Unaccounted calls add to recorded unavailable ones.
    expect(modelCost(summary({ g: 1, u: 1 }, 0.003, false), 4).model_calls_unavailable).toBe(3);
  });

  it("is complete only when every call has a known cost, or there were no calls", () => {
    expect(modelCost(summary({}, 0, true), 0).model_complete).toBe(true);
    expect(modelCost(summary({ g: 2 }, 0.01, true), 2).model_complete).toBe(true);
    expect(modelCost(summary({ g: 2, u: 1 }, 0.01, true), 3).model_complete).toBe(false);
    // The pipeline's own flag must agree too.
    expect(modelCost(summary({ g: 2 }, 0.01, false), 2).model_complete).toBe(false);
  });

  it("copies known_usd from the result into model_usd in live mode", () => {
    const dto = live(
      withCost(base, { known_usd: 0.003, calls_by_basis: { gateway_reported: 0, estimated: 3, unavailable: 2 }, complete: false }, 5),
    );
    expect(dto.run.cost).toMatchObject({
      model_usd: 0.003,
      model_basis: "estimated",
      model_complete: false,
      model_calls_unavailable: 2,
    });
  });
});

describe("safe mapping", () => {
  const SECRET = "UPSTREAM-SECRET";

  function tampered(): PipelineResult {
    return {
      ...base,
      issues: [
        { step: "enrich", code: "enrich_partial", message: `${SECRET} provider said sk-live-123` },
        { step: "search", code: "made up code!" as never, message: `${SECRET} free text` },
      ],
      prospects: base.prospects.map((p, i) => {
        if (i === 0) {
          return {
            ...p,
            validation: {
              status: "flagged" as const,
              issues: [
                { code: "junk_website" as const, field: "website", reason: `${SECRET}: the site points to evil.example` },
                { code: "size_headcount_mismatch" as const, field: "bad field!", reason: `${SECRET} 9999 employees` },
              ],
            },
            checks: {
              assessment: {
                ok: false,
                findings: [
                  { code: "missing_criterion" as const, severity: "error" as const, message: `${SECRET} finding`, fact_id: "f-secret-1", criterion: "secret-criterion" },
                ],
              },
              claims: {
                ok: false,
                findings: [
                  { code: "unsupported_number" as const, severity: "error" as const, message: `${SECRET} claim`, fact_id: "f-secret-2" },
                ],
              },
              outreach: "removed" as const,
            },
          };
        }
        if (i === 1) {
          return { ...p, assessment: { status: "failed" as const, reason: "llm_error" as const, message: `${SECRET} gateway error: key sk-abc` } };
        }
        return p;
      }),
    };
  }

  it("replaces failed-assessment messages with fixed text by reason", () => {
    const dto = live(tampered());
    const failed = dto.prospects[1].assessment;
    expect(failed).toEqual({ status: "failed", reason: "llm_error", message: "The model call did not return an answer." });
  });

  it("replaces pipeline issue messages with fixed text by code", () => {
    const dto = live(tampered());
    expect(dto.issues).toEqual([
      { code: "enrich_partial", message: "Some companies could not be enriched, so those use basic search data only." },
      { code: UNKNOWN_CODE, message: GENERIC_ISSUE_MESSAGE },
    ]);
  });

  it("replaces finding text and drops fact_id and criterion", () => {
    const p = live(tampered()).prospects[0];
    const findings = [
      ...p.guard.assessment_findings,
      ...p.guard.claim_findings,
      ...(p.outreach.state === "suppressed" ? p.outreach.findings : []),
    ];
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(Object.keys(f).sort()).toEqual(["code", "message", "severity"]);
    expect(p.guard.assessment_findings[0].message).toBe("A requested criterion was not scored.");
    expect(p.guard.claim_findings[0].message).toBe("The outreach states a number no cited fact supports.");
    expect(p.outreach.state).toBe("suppressed");
  });

  it("replaces validation reasons by code and unsafe field names", () => {
    const issues = live(tampered()).prospects[0].validation.issues;
    expect(issues).toEqual([
      { code: "junk_website", field: "website", reason: "The website is not a company site." },
      { code: "size_headcount_mismatch", field: UNKNOWN_CODE, reason: "The listed size, headcount or revenue do not agree." },
    ]);
    expect(GENERIC_VALIDATION_REASON).not.toContain(SECRET);
  });

  it("carries no upstream text, finding references or raw records anywhere", () => {
    for (const dto of [live(tampered()), synthetic(tampered())]) {
      const json = JSON.stringify(dto);
      for (const leaked of [SECRET, "sk-", "evil.example", "f-secret", "secret-criterion"]) {
        expect(json).not.toContain(leaked);
      }
      for (const key of ["raw", "llm_call", "filters", "input_description", "trace_id", "latest_key_spend", "fact_id"]) {
        expect(json).not.toContain(`"${key}":`);
      }
    }
  });

  it("is independent of ResultsDto, which still forwards its own messages unchanged", () => {
    expect(JSON.stringify(toResultsDto(tampered()))).toContain(SECRET);
  });

  it("is plain JSON", () => {
    const dto: LiveResultsDto = live(base);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
});
