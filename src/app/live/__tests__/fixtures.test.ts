// The preview's synthetic fixtures: real ResultsDto values from the shared
// presentation code, clearly labelled as synthetic, never as live.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildPreviewFixtures, PARTIAL_MODEL_CALL_CAP, PREVIEW_NOTICE } from "../_lib/fixtures";
import type { PreviewFixtures } from "../_lib/preview";

let fixtures: PreviewFixtures;
beforeAll(async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
  fixtures = await buildPreviewFixtures();
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe("preview fixtures", () => {
  it("are deterministic", async () => {
    expect(await buildPreviewFixtures()).toEqual(fixtures);
  });

  it("are ResultsDto values from synthetic fixtures, not live data", () => {
    for (const response of [fixtures.success, fixtures.partial]) {
      expect(response.status).toBe("ok");
      expect(response.results.mode).toBe("synthetic");
      expect(response.results.run.fact_provider).toBe("fixture");
      expect(response.results.run.actual_spend_usd).toBe(0);
      expect(response.notices[0]).toBe(PREVIEW_NOTICE);
      expect(PREVIEW_NOTICE).toMatch(/synthetic/i);
      expect(PREVIEW_NOTICE).toMatch(/not a live result/i);
    }
  });

  it("take usage counts from the results they accompany", () => {
    for (const response of [fixtures.success, fixtures.partial]) {
      expect(response.usage.searched).toBe(response.results.run.counts.searched);
      expect(response.usage.enriched).toBe(response.results.run.counts.enriched);
      expect(response.usage.providerCostUsd).toBe(response.results.run.simulated_provider_cost_usd.total);
    }
  });

  it("give a complete success and a genuinely partial run", () => {
    expect(fixtures.success.results.issues).toEqual([]);
    expect(fixtures.partial.results.issues.map((i) => i.code)).toContain("llm_call_cap_reached");
    expect(fixtures.partial.results.run.counts.model_calls).toBe(PARTIAL_MODEL_CALL_CAP);
    expect(
      fixtures.partial.results.prospects.some(
        (p) => p.assessment.status === "not_assessed" && p.assessment.reason === "llm_call_cap",
      ),
    ).toBe(true);
  });

  it("contain no raw records or credentials", () => {
    // Raw record fields would appear as JSON keys. (Field names may appear as
    // values, e.g. a validation issue's "field", which is part of the DTO.)
    const json = JSON.stringify(fixtures);
    for (const field of ["professional_network_url", "primary_domain", "website", "retrieved_at", "record_id", "api_key", "raw"]) {
      expect(json).not.toContain(`"${field}":`);
    }
  });
});
