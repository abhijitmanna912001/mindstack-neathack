// The official live-data evaluation (evidence/summary.json real_data):
// parsing, rendering, the caveat beside the validation counts, malformed
// input, and separation from the fixture comparison and the synthetic demo.
// Expected values come from the imported file, never from literals.

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import summary from "../../../../evidence/summary.json";
import { DemoNotice } from "../_components/DemoNotice";
import { LiveDataPanel } from "../_components/LiveDataPanel";
import { OfficialEvidencePanel } from "../_components/OfficialEvidencePanel";
import { parseEvidenceSummary, parseLiveData } from "../_lib/evidence";
import { DEMO_UNSUPPORTED_NUMBER_COMPANY_ID } from "../_lib/guardrail-demo";

const live = summary.real_data;
const markup = (node: ReactElement) => renderToStaticMarkup(node);
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const clone = () => JSON.parse(JSON.stringify(live)) as Record<string, unknown>;

describe("parseLiveData with the official real_data", () => {
  const parsed = parseLiveData(live);
  if (parsed.state !== "ready") throw new Error(`expected ready, got ${JSON.stringify(parsed)}`);
  const { data } = parsed;

  it("keeps every published count and string exactly as the file states it", () => {
    expect(data.source).toBe(live.source);
    expect(data.slice).toBe(live.slice);
    expect(data.searched).toBe(live.searched);
    expect(data.enriched_in_both_pipelines).toBe(live.enriched_in_both_pipelines);
    expect(data.search_stage_validation).toEqual(live.search_stage_validation);
    expect(data.after_enrichment_validation).toEqual(live.after_enrichment_validation);
    expect(data.valid_to_flagged).toBe(live.changed_by_enrichment.valid_to_flagged);
    expect(data.rules_fired).toEqual(Object.entries(live.rules_fired).map(([code, count]) => ({ code, count })));
    expect(data.baseline_revalidates_after_enrichment).toBe(live.baseline_revalidates_after_enrichment);
    expect(data.improved_assessed).toEqual(live.improved_assessed);
    expect(data.provider_cost_usd_measured_per_run).toBe(live.provider_cost_usd_measured_per_run);
    expect(data.caveat).toBe(live.caveat);
  });

  it("reads the fake-model, no-model-calls, tracing-off statement from the source text", () => {
    expect(data.source_states_no_real_model).toBe(true);
    const otherSource = parseLiveData({ ...clone(), source: "Crustdata live API, claude-haiku" });
    if (otherSource.state !== "ready") throw new Error("expected ready");
    expect(otherSource.data.source_states_no_real_model).toBe(false);
  });

  it("ignores fields outside the approved set", () => {
    const withExtra = parseLiveData({ ...clone(), company_ids: [123456], records: [{ name: "Acme" }] });
    expect(withExtra.state).toBe("ready");
    expect(JSON.stringify(withExtra)).not.toContain("123456");
    expect(JSON.stringify(withExtra)).not.toContain("Acme");
  });
});

describe("parseLiveData with malformed input", () => {
  const mutate = (fn: (d: Record<string, unknown>) => void) => {
    const d = clone();
    fn(d);
    return d;
  };
  const nested = (d: Record<string, unknown>, key: string) => d[key] as Record<string, unknown>;

  it.each([
    ["not an object", () => "live"],
    ["an array", () => [1, 2]],
    ["missing source", () => mutate((d) => delete d.source)],
    ["empty slice", () => mutate((d) => (d.slice = ""))],
    ["missing caveat", () => mutate((d) => delete d.caveat)],
    ["string searched", () => mutate((d) => (d.searched = "10"))],
    ["negative enriched", () => mutate((d) => (d.enriched_in_both_pipelines = -1))],
    ["fractional count", () => mutate((d) => (nested(d, "after_enrichment_validation").flagged = 1.5))],
    ["missing stage count", () => mutate((d) => delete nested(d, "search_stage_validation").rejected)],
    ["stage not an object", () => mutate((d) => (d.after_enrichment_validation = 7))],
    ["missing transition", () => mutate((d) => (d.changed_by_enrichment = {}))],
    ["rules not an object", () => mutate((d) => (d.rules_fired = ["size_headcount_mismatch"]))],
    ["rule key with digits", () => mutate((d) => (d.rules_fired = { "company_1234567:name": 1 }))],
    ["rule count not an integer", () => mutate((d) => (d.rules_fired = { size_headcount_mismatch: "3" }))],
    ["non-boolean revalidation flag", () => mutate((d) => (d.baseline_revalidates_after_enrichment = "no"))],
    ["missing improved flagged count", () => mutate((d) => (d.improved_assessed = { valid: 2 }))],
    ["negative cost", () => mutate((d) => (d.provider_cost_usd_measured_per_run = -3))],
  ])("rejects %s, showing nothing partial", (_label, make) => {
    const result = parseLiveData(make());
    expect(result.state).toBe("invalid");
    expect(result).not.toHaveProperty("data");
  });
});

describe("LiveDataPanel with the official real_data", () => {
  const state = parseEvidenceSummary(summary);
  const html = markup(<LiveDataPanel state={state} />);
  const out = text(html);

  it("renders the source, slice and every published count", () => {
    expect(out).toContain(live.source);
    expect(out).toContain(live.slice);
    expect(out).toContain(`Searched ${live.searched}`);
    expect(out).toContain(`Enriched in both pipelines ${live.enriched_in_both_pipelines}`);
    expect(out).toContain(`$${live.provider_cost_usd_measured_per_run}`);
    expect(out).toContain("Measured, not simulated");
    for (const status of ["valid", "flagged", "rejected"] as const) {
      const label = status[0].toUpperCase() + status.slice(1);
      expect(out).toContain(
        `${label} ${live.search_stage_validation[status]} ${live.after_enrichment_validation[status]}`,
      );
    }
    expect(out).toContain(`valid → flagged ${live.changed_by_enrichment.valid_to_flagged}`);
    for (const [code, count] of Object.entries(live.rules_fired)) expect(out).toContain(`${code} ${count}`);
    expect(out).toContain(`Baseline revalidates after enrichment ${live.baseline_revalidates_after_enrichment ? "Yes" : "No"}`);
    expect(out).toContain(`${live.improved_assessed.valid} valid, ${live.improved_assessed.flagged} flagged`);
  });

  it("states the run used the fake model, made no model calls and had tracing disabled", () => {
    expect(out).toContain("with the fake model: no model calls were made and tracing was disabled");
    expect(out).not.toMatch(/claude|real model was called/i);
  });

  it("shows the exact caveat from the file directly after the validation counts", () => {
    expect(out).toContain(live.caveat);
    const tableEnd = html.indexOf("</table>");
    const caveatAt = html.indexOf(live.caveat.replace(/'/g, "&#x27;").slice(0, 40));
    const nextSection = html.indexOf("Changed by enrichment");
    expect(tableEnd).toBeGreaterThan(-1);
    // Caveat sits between the validation table and the following details.
    expect(caveatAt).toBeGreaterThan(tableEnd);
    expect(caveatAt).toBeLessThan(nextSection);
  });

  it("never presents a flag as proof the data is wrong", () => {
    // The only statement about data correctness is the file's own caveat;
    // the rest of the panel makes no claim either way.
    expect(out).toContain(live.caveat);
    const rest = out.replace(live.caveat, "");
    expect(rest).not.toMatch(/\bproof\b|\bproves?\b/i);
    expect(rest).not.toMatch(/(data|records?) (is|are) (wrong|incorrect|invalid|bad)/i);
  });

  it("shows no company records or company ids", () => {
    // Company ids are 4+ digit numbers. The only such number is the slice's
    // count of matching companies, which is part of the published slice text.
    expect(out).not.toMatch(/\b\d{4,}\b(?! companies match)/);
    for (const field of ["crustdata_company_id", "professional_network_url", "primary_domain", "retrieved_at"]) {
      expect(html).not.toContain(field);
    }
  });
});

describe("separation from the fixture comparison and the synthetic demo", () => {
  it("leaves the official fixture comparison unchanged", () => {
    const withLive = parseEvidenceSummary(summary);
    const withoutLive = parseEvidenceSummary({ ...summary, real_data: null });
    expect(markup(<OfficialEvidencePanel state={withLive} />)).toBe(markup(<OfficialEvidencePanel state={withoutLive} />));
  });

  it("keeps the fixture panel and demo notice free of live-data content", () => {
    const fixture = text(markup(<OfficialEvidencePanel state={parseEvidenceSummary(summary)} />));
    const demo = text(markup(<DemoNotice companyId={DEMO_UNSUPPORTED_NUMBER_COMPANY_ID} />));
    for (const out of [fixture, demo]) {
      expect(out).not.toContain(live.caveat);
      expect(out).not.toContain(live.slice);
    }
  });

  it("keeps the live-data panel free of the synthetic demonstration", () => {
    const out = text(markup(<LiveDataPanel state={parseEvidenceSummary(summary)} />));
    expect(out).not.toMatch(/inject|guardrail demonstration/i);
  });
});
