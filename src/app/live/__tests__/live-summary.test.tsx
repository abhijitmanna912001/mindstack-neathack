// LiveRunSummary, the mode banner and the run notices in both modes. The
// live-mode DTOs are built inside this test only, from the synthetic run, to
// exercise the live display; the page itself never shows live data.

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LlmCostSummary, PipelineResult } from "../../../core/agent/types";
import { runSyntheticPipeline } from "../../results/_lib/synthetic-run";
import { MODE_BANNER_TITLES, ModeBanner, RunNotices } from "../_components/LiveNotices";
import { LiveOutcome } from "../_components/LiveOutcome";
import { CRUSTDATA_SOURCE_OF_TRUTH, LiveRunSummary } from "../_components/LiveRunSummary";
import { type LiveRunSuccess, SYNTHETIC_NOTICES } from "../_lib/contract";
import { type LiveResultsDto, toLiveResultsDto } from "../_lib/live-results";
import { viewStateFor } from "../_lib/submission";

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

const text = (node: ReactElement) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ");

function liveDto(llm_cost: Partial<LlmCostSummary> = {}, llmCalls?: number): LiveResultsDto {
  const result: PipelineResult = {
    ...base,
    run: llmCalls === undefined ? base.run : { ...base.run, counts: { ...base.run.counts, llm_calls: llmCalls } },
    usage: { ...base.usage, llm_cost: { ...base.usage.llm_cost, ...llm_cost } },
  };
  return toLiveResultsDto(result, { mode: "live", model: "claude-haiku" });
}
const syntheticDto = () => toLiveResultsDto(base, { mode: "synthetic", model: "fake" });

const GATEWAY = { known_usd: 0.0183, calls_by_basis: { gateway_reported: 5, estimated: 0, unavailable: 0 }, complete: true };
const ESTIMATED = { known_usd: 0.0042, calls_by_basis: { gateway_reported: 0, estimated: 5, unavailable: 0 }, complete: true };
const MIXED = { known_usd: 0.011, calls_by_basis: { gateway_reported: 3, estimated: 2, unavailable: 0 }, complete: true };
const INCOMPLETE = { known_usd: 0.009, calls_by_basis: { gateway_reported: 3, estimated: 0, unavailable: 2 }, complete: false };
const INCOMPLETE_ESTIMATED = { known_usd: 0.003, calls_by_basis: { gateway_reported: 0, estimated: 3, unavailable: 2 }, complete: false };
const INCOMPLETE_MIXED = { known_usd: 0.006, calls_by_basis: { gateway_reported: 1, estimated: 1, unavailable: 2 }, complete: false };
const UNAVAILABLE = { known_usd: 0, calls_by_basis: { gateway_reported: 0, estimated: 0, unavailable: 5 }, complete: false };
const NONE = { known_usd: 0, calls_by_basis: { gateway_reported: 0, estimated: 0, unavailable: 0 }, complete: true };

// Phrases a live-mode page must never use.
const NEVER_IN_LIVE = [
  /fake model/i,
  /fake-model/i,
  /actual spend/i,
  /actual charges/i,
  /nothing was billed/i,
  /no (real |external )?model was called/i,
  /simulated/i,
  /demo data/i,
  /\$0(?:\.0+)?(?![\d.])/, // "$0" or "$0.00", but not "$0.0183"
];

describe("LiveRunSummary in synthetic mode", () => {
  const out = () => text(<LiveRunSummary results={syntheticDto()} />);

  it("identifies the run as demo data from fixtures and a fake model", () => {
    expect(out()).toContain("Demo data (synthetic)");
    expect(out()).toContain("Synthetic fixture companies");
    expect(out()).toContain("fake: a deterministic fake model in this app");
    expect(out()).toContain("Fake-model calls");
  });

  it("never implies a real company search, and says the criteria were not used", () => {
    expect(out()).toContain("No real company search was made");
    expect(out()).toContain("your search criteria were not used");
    expect(out()).not.toContain("Live Crustdata data");
    expect(out()).not.toContain(CRUSTDATA_SOURCE_OF_TRUTH);
  });

  it("keeps simulated provider prices labelled as simulated and not a charge", () => {
    const dto = syntheticDto();
    expect(out()).toContain(`Simulated provider cost $${dto.run.cost.provider_usd.toFixed(2)}, simulated from fixture per-record prices. Not a charge.`);
    expect(out()).toContain("Actual charges None: no external provider or model was called for this demo run.");
  });

  it("reports no external model cost, keeps the fake-model call count, and hides the simulated estimate", () => {
    const dto = syntheticDto();
    expect(dto.run.cost.model_basis).toBe("none");
    const calls = dto.run.counts.model_calls;
    expect(calls).toBeGreaterThan(0);
    expect(out()).toContain(`Fake-model calls ${calls}`);
    expect(out()).toContain(`Model cost None: no external model was called. The ${calls} fake-model calls ran inside this app.`);
    // FakeLlmClient's simulated estimate is never shown as a model cost.
    const simulated = `$${base.usage.llm_cost.known_usd.toFixed(4)}`;
    expect(base.usage.llm_cost.known_usd).toBeGreaterThan(0);
    expect(out()).not.toContain(simulated);
    expect(out()).not.toContain("Simulated model cost");
  });
});

describe("LiveRunSummary in live mode", () => {
  const out = (dto: LiveResultsDto) => text(<LiveRunSummary results={dto} />);

  it("labels the results as live Crustdata data with the model used", () => {
    const o = out(liveDto(GATEWAY));
    expect(o).toContain("Live Crustdata data");
    expect(o).toContain("Model claude-haiku");
    expect(o).toContain("Model calls");
  });

  it("shows the provider cost estimate, its basis, and the Crustdata source of truth", () => {
    const dto = liveDto(GATEWAY);
    const o = out(dto);
    expect(o).toContain(`Provider cost estimate $${dto.run.cost.provider_usd.toFixed(4)}`);
    expect(o).toContain("estimated from the records searched and enriched at measured per-record prices");
    expect(o).toContain("not an invoice");
    expect(o).toContain(CRUSTDATA_SOURCE_OF_TRUTH);
  });

  const callsIn = (cost: { calls_by_basis: { gateway_reported: number; estimated: number; unavailable: number } }) =>
    cost.calls_by_basis.gateway_reported + cost.calls_by_basis.estimated + cost.calls_by_basis.unavailable;
  const ALL = [GATEWAY, ESTIMATED, MIXED, INCOMPLETE, INCOMPLETE_ESTIMATED, INCOMPLETE_MIXED, UNAVAILABLE, NONE];

  it("calls only a complete, gateway-reported amount a total", () => {
    const o = out(liveDto(GATEWAY, 5));
    expect(o).toContain("Model cost $0.0183 total, reported by the model gateway for 5 calls.");
    expect(o).not.toContain("Incomplete");
    for (const cost of ALL.filter((c) => c !== GATEWAY)) {
      expect(out(liveDto(cost, callsIn(cost)))).not.toMatch(/\btotal,/);
    }
  });

  it("shows an all-estimated, complete cost as a normal result, not an error", () => {
    const o = out(liveDto(ESTIMATED, 5));
    expect(o).toContain("Model cost $0.0042, estimated from token usage at fallback rates for 5 calls.");
    expect(o).not.toContain("Incomplete");
    expect(o).not.toMatch(/unavailable|at least|error/i);
  });

  it("describes a mixed cost's parts without calling it a confirmed total", () => {
    const o = out(liveDto(MIXED, 5));
    expect(o).toContain(
      "Model cost $0.0110, partly reported by the model gateway and partly estimated from token usage at fallback rates across 5 calls. Part of it is an estimate, so it is not a confirmed total.",
    );
    expect(o).not.toContain("Incomplete");
  });

  it("says when there were no model calls", () => {
    const o = out(liveDto(NONE, 0));
    expect(o).toContain("Model cost No model calls were made in this run.");
    expect(o).not.toContain("Incomplete");
  });

  it.each([
    ["gateway-reported plus unavailable", INCOMPLETE, "At least $0.0090 (incomplete): 2 of 5 calls have no cost information. The known amount is reported by the model gateway."],
    ["estimated plus unavailable", INCOMPLETE_ESTIMATED, "At least $0.0030 (incomplete): 2 of 5 calls have no cost information. The known amount is estimated from token usage at fallback rates."],
    ["both known kinds plus unavailable", INCOMPLETE_MIXED, "At least $0.0060 (incomplete): 2 of 4 calls have no cost information. The known amount is partly reported by the model gateway and partly estimated from token usage at fallback rates."],
  ] as const)("shows %s as a lower bound with the missing-call count, never as a total", (_name, cost, expected) => {
    const o = out(liveDto(cost, callsIn(cost)));
    expect(o).toContain("Incomplete");
    expect(o).toContain(`Model cost Incomplete ${expected}`);
    expect(o).not.toMatch(new RegExp(`Model cost \\$${cost.known_usd.toFixed(4).replace(".", "\\.")}`));
    expect(o).not.toMatch(/\btotal\b/i);
  });

  it("counts calls missing from the basis counts as lacking cost information", () => {
    // Five calls, three gateway-reported, two unaccounted for.
    const dto = liveDto({ known_usd: 0.009, calls_by_basis: { gateway_reported: 3, estimated: 0, unavailable: 0 }, complete: true }, 5);
    expect(dto.run.cost.model_calls_unavailable).toBe(2);
    expect(out(dto)).toContain("At least $0.0090 (incomplete): 2 of 5 calls have no cost information.");
  });

  it("shows a fully unavailable cost as unavailable, never as $0.00, though model_usd is 0", () => {
    const dto = liveDto(UNAVAILABLE, 5);
    expect(dto.run.cost.model_usd).toBe(0);
    expect(dto.run.cost.model_calls_unavailable).toBe(5);
    const o = out(dto);
    expect(o).toContain("Model cost Incomplete Unavailable: no cost information for any of the 5 model calls.");
    expect(o).not.toMatch(/Model cost[^.]*\$/);
    expect(o).not.toMatch(/\$0(?:\.0+)?(?![\d.])/);
  });

  it("never says spend was zero or that a fake model was used", () => {
    for (const cost of ALL) {
      const o = out(liveDto(cost, callsIn(cost)));
      for (const phrase of NEVER_IN_LIVE) expect(o).not.toMatch(phrase);
    }
  });

  it("does not show a zero provider estimate as a dollar amount", () => {
    const dto = liveDto(GATEWAY);
    const zero: LiveResultsDto = { ...dto, run: { ...dto.run, cost: { ...dto.run.cost, provider_usd: 0 } } };
    const o = out(zero);
    expect(o).toContain("Provider cost estimate None estimated");
    expect(o).not.toMatch(/\$0(?:\.0+)?(?![\d.])/);
  });
});

describe("mode banner and notices", () => {
  it("names each mode clearly", () => {
    expect(MODE_BANNER_TITLES).toEqual({ synthetic: "Demo data (synthetic)", live: "Live Crustdata data" });
    expect(text(<ModeBanner mode="synthetic" model="fake" />)).toContain("Demo data (synthetic)");
    expect(text(<ModeBanner mode="synthetic" model="fake" />)).toContain("your search criteria were not used");
    const live = text(<ModeBanner mode="live" model="claude-haiku" />);
    expect(live).toContain("Live Crustdata data");
    expect(live).toContain("assessed by claude-haiku");
  });

  it("always shows both synthetic notices in synthetic mode, first and once", () => {
    const o = text(<RunNotices mode="synthetic" notices={["Another notice.", SYNTHETIC_NOTICES[1]]} />);
    for (const notice of SYNTHETIC_NOTICES) expect(o.split(notice)).toHaveLength(2);
    expect(o.indexOf(SYNTHETIC_NOTICES[0])).toBeLessThan(o.indexOf("Another notice."));
    expect(text(<RunNotices mode="synthetic" notices={[]} />)).toContain(SYNTHETIC_NOTICES[0]);
  });

  it("never shows the synthetic notices in live mode", () => {
    const o = text(<RunNotices mode="live" notices={["Searched the closest industry."]} />);
    expect(o).toContain("Searched the closest industry.");
    for (const notice of SYNTHETIC_NOTICES) expect(o).not.toContain(notice);
  });
});

describe("a live-mode outcome", () => {
  const response = (): LiveRunSuccess => ({
    status: "ok",
    mode: "live",
    results: liveDto(GATEWAY),
    usage: { runsRemaining: 1 },
    notices: [],
  });

  it("uses the live banner, live summary and live metrics title, with no synthetic labels", () => {
    const o = text(<LiveOutcome state={viewStateFor(response())} preview={false} onBack={() => {}} onRetry={() => {}} />);
    expect(o).toContain("Live Crustdata data");
    expect(o).toContain("Live run summary");
    expect(o).toContain("Guardrail metrics");
    expect(o).not.toContain("Demo run");
    expect(o).not.toContain("Synthetic preview data");
    expect(o).not.toContain("made-up preview value");
    for (const notice of SYNTHETIC_NOTICES) expect(o).not.toContain(notice);
    expect(o).toContain(CRUSTDATA_SOURCE_OF_TRUTH);
  });
});
