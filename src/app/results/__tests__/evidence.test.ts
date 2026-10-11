// The official evidence summary (evidence/summary.json) through the page's
// validator. Expected values are read from the imported file itself, never
// copied into this test.

import { describe, expect, it } from "vitest";
import summary from "../../../../evidence/summary.json";
import { EVIDENCE_METRICS, parseEvidenceSummary } from "../_lib/evidence";

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(summary));
const KNOWN = new Set<string>(EVIDENCE_METRICS.map((m) => m.key));

describe("parseEvidenceSummary with the official file", () => {
  const result = parseEvidenceSummary(summary);
  if (result.state !== "ready") throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  const parsed = result.summary;

  it("accepts the official evidence summary", () => {
    expect(result.state).toBe("ready");
  });

  it("passes the scenario, source reports, cost basis and notes through unchanged", () => {
    expect(parsed.scenario).toBe(summary.scenario);
    expect(parsed.source_reports).toEqual(summary.source_reports);
    expect(parsed.provider_cost_basis).toBe(summary.provider_cost_basis);
    expect(parsed.notes).toEqual(summary.notes);
  });

  it.each(["baseline", "improved"] as const)("keeps every known %s figure exactly as the file states it", (run) => {
    const source = summary[run] as Record<string, number>;
    for (const [key, value] of Object.entries(source)) {
      if (KNOWN.has(key)) expect(parsed[run][key as keyof typeof parsed.baseline], `${run}.${key}`).toBe(value);
    }
    // Nothing appears that the file does not state.
    for (const key of Object.keys(parsed[run])) expect(source).toHaveProperty(key);
  });

  it("knows every metric the official file reports", () => {
    for (const run of ["baseline", "improved"] as const) {
      for (const key of Object.keys(summary[run])) expect(KNOWN.has(key), `${run}.${key}`).toBe(true);
    }
  });

  it("leaves metrics a run does not report missing, instead of zero", () => {
    for (const key of Object.keys(summary.improved)) {
      if (!(key in summary.baseline)) expect(parsed.baseline[key as keyof typeof parsed.baseline]).toBeUndefined();
    }
  });

  it("parses the official live-data evaluation", () => {
    expect(result.live_data.state).toBe("ready");
  });
});

describe("parseEvidenceSummary with other input", () => {
  it("marks null real_data as a pending live-data evaluation", () => {
    const result = parseEvidenceSummary({ ...clone(), real_data: null });
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.live_data).toEqual({ state: "pending" });
  });

  it("rejects malformed live data as a whole, keeping the fixture summary", () => {
    const result = parseEvidenceSummary({ ...clone(), real_data: { baseline: { assessed: 99 } } });
    if (result.state !== "ready") throw new Error("expected ready");
    expect(result.live_data.state).toBe("invalid");
    expect(result.live_data).not.toHaveProperty("data");
    const official = parseEvidenceSummary(summary);
    if (official.state !== "ready") throw new Error("expected ready");
    expect(result.summary).toEqual(official.summary);
  });

  it("ignores unknown fields", () => {
    const input = clone();
    (input.baseline as Record<string, unknown>).secret_metric = 12345;
    input.unknown_top_level = { anything: 1 };
    const result = parseEvidenceSummary(input);
    expect(result.state).toBe("ready");
    expect(JSON.stringify(result)).not.toContain("secret_metric");
    expect(JSON.stringify(result)).not.toContain("unknown_top_level");
  });

  const mutate = (fn: (input: Record<string, unknown>) => void) => {
    const input = clone();
    fn(input);
    return input;
  };
  const run = (input: Record<string, unknown>, name: "baseline" | "improved") => input[name] as Record<string, unknown>;

  it.each([
    ["not an object", () => ["a"]],
    ["string count", () => mutate((i) => (run(i, "baseline").model_calls = "10"))],
    ["negative count", () => mutate((i) => (run(i, "improved").assessed = -1))],
    ["fractional count", () => mutate((i) => (run(i, "baseline").tokens_in = 1.5))],
    ["negative cost", () => mutate((i) => (run(i, "improved").model_cost_usd = -0.01))],
    ["string cost", () => mutate((i) => (run(i, "baseline").provider_cost_usd = "3.69"))],
    ["missing baseline", () => mutate((i) => delete i.baseline)],
    ["run with no known metrics", () => mutate((i) => (i.improved = { something_else: 1 }))],
    ["empty scenario", () => mutate((i) => (i.scenario = ""))],
    ["notes not a list", () => mutate((i) => (i.notes = "note"))],
    ["empty source reports", () => mutate((i) => (i.source_reports = []))],
    ["missing cost basis", () => mutate((i) => delete i.provider_cost_basis)],
    ["missing real_data", () => mutate((i) => delete i.real_data)],
  ])("rejects %s and shows no figures", (_label, make) => {
    const result = parseEvidenceSummary(make());
    expect(result.state).toBe("invalid");
    expect(result).not.toHaveProperty("summary");
  });
});
