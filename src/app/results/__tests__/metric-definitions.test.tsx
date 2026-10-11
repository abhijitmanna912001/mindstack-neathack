// What "assessed" and "delivered" mean, checked against the pipeline's own
// values and the wording the page shows. Synthetic fixtures and the fake
// model only; global fetch is stubbed to throw.
//
// Definitions (Abhijit): assessed prospects received an assessment and have a
// score; delivered counts eligible prospects. In the improved pipeline,
// delivered = prospects whose final validation status is not "rejected".

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import summary from "../../../../evidence/summary.json";
import { OfficialEvidencePanel } from "../_components/OfficialEvidencePanel";
import {
  ASSESSED_HINT,
  DELIVERED_HINT,
  ENRICHMENT_ELIGIBLE_HINT,
  RunSummary,
} from "../_components/RunSummary";
import { parseEvidenceSummary } from "../_lib/evidence";
import type { ResultsDto } from "../_lib/presentation";
import { loadSyntheticResults } from "../_lib/synthetic-run";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const text = (node: ReactElement) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

async function demo(): Promise<ResultsDto> {
  const loaded = await loadSyntheticResults(undefined);
  if (loaded.kind !== "ok") throw new Error("expected results");
  return loaded.results;
}

describe("demo run metric values", () => {
  it("delivered counts eligible prospects: final validation not rejected", async () => {
    const results = await demo();
    const eligible = results.prospects.filter((p) => p.validation.status !== "rejected");
    expect(results.run.counts.delivered).toBe(eligible.length);
    expect(eligible.every((p) => p.validation.status === "valid" || p.validation.status === "flagged")).toBe(true);
  });

  it("delivered is not outreach kept after guard checks, and includes unassessed prospects", async () => {
    const results = await demo();
    const kept = results.prospects.filter((p) => p.outreach.state === "kept").length;
    const eligibleNotAssessed = results.prospects.filter(
      (p) => p.validation.status !== "rejected" && p.assessment.status === "not_assessed",
    );
    expect(results.run.counts.delivered).not.toBe(kept);
    expect(eligibleNotAssessed.length).toBeGreaterThan(0);
  });

  it("assessed counts prospects that received an assessment with a fit score", async () => {
    const results = await demo();
    const scored = results.prospects.filter((p) => p.assessment.status === "assessed");
    expect(results.run.counts.assessed).toBe(scored.length);
    for (const p of scored) {
      if (p.assessment.status === "assessed") expect(Number.isFinite(p.assessment.fit_score)).toBe(true);
    }
  });
});

describe("demo run summary wording", () => {
  it("labels delivered as eligible prospects, not as kept outreach", async () => {
    const out = text(<RunSummary results={await demo()} />);
    expect(out).toContain("Delivered (eligible)");
    expect(out).toContain(DELIVERED_HINT);
    expect(DELIVERED_HINT).toMatch(/not rejected by validation/);
    expect(DELIVERED_HINT).not.toMatch(/outreach|draft|guard|kept/i);
    expect(out).not.toContain("Kept after validation");
  });

  it("labels assessed as scored assessments, and enrichment eligibility separately", async () => {
    const out = text(<RunSummary results={await demo()} />);
    expect(out).toContain(ASSESSED_HINT);
    expect(ASSESSED_HINT).toMatch(/fit score/);
    expect(out).not.toContain("Sent to the fake model");
    expect(out).toContain(ENRICHMENT_ELIGIBLE_HINT);
  });
});

describe("official fixture panel definitions", () => {
  const out = text(<OfficialEvidencePanel state={parseEvidenceSummary(summary)} />);

  it("defines assessed and delivered the same way, with assessed figures from the file", () => {
    expect(out).toContain("Assessed (scored)");
    expect(out).toContain("received an assessment and have a score");
    expect(out).toContain("counts eligible prospects, those not rejected by validation");
    expect(out).toContain(String(summary.baseline.assessed));
    expect(out).toContain(String(summary.improved.assessed));
  });

  it("keeps delivered unreported, because the official file does not state it", () => {
    expect(summary.baseline).not.toHaveProperty("delivered");
    expect(summary.improved).not.toHaveProperty("delivered");
    expect(out).toContain("does not report delivered counts");
    expect(out).not.toMatch(/Delivered \(eligible\)/);
  });

  it("does not mention the synthetic demonstration", () => {
    expect(out).not.toMatch(/demonstration|inject|fake model/i);
  });
});
