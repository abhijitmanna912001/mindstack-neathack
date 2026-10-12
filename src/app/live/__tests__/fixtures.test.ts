// The preview's synthetic fixtures: LiveResultsDto values in synthetic mode,
// the same run a synthetic-mode code gets from the server, clearly labelled
// as synthetic and never as live.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_UNSUPPORTED_NUMBER_COMPANY_ID } from "../../results/_lib/guardrail-demo";
import { SIMULATED_COST_PER_RECORD } from "../../results/_lib/synthetic-config";
import { runSyntheticPipeline } from "../../results/_lib/synthetic-run";
import { SYNTHETIC_NOTICES } from "../_lib/contract";
import {
  buildPreviewFixtures,
  PARTIAL_MODEL_CALL_CAP,
  PARTIAL_PREVIEW_NOTICE,
  PREVIEW_NOTICE,
  SYNTHETIC_MODEL_NAME,
} from "../_lib/fixtures";
import { toLiveResultsDto } from "../_lib/live-results";
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

  it("are synthetic-mode LiveResultsDto values, never live", () => {
    for (const response of [fixtures.success, fixtures.partial]) {
      const { run } = response.results;
      expect(response.status).toBe("ok");
      expect(response.mode).toBe("synthetic");
      expect(run.mode).toBe("synthetic");
      expect(run.data_source).toBe("fixtures");
      expect(run.fact_provider).toBe("fixture");
      expect(run.model).toBe(SYNTHETIC_MODEL_NAME);
      expect(run.cost.provider_basis).toBe("simulated_fixture_prices");
      expect(run.cost).toMatchObject({ model_basis: "none", model_usd: 0, model_complete: true, model_calls_unavailable: 0 });
      expect(run.counts.model_calls).toBeGreaterThan(0);
      expect(JSON.stringify(response)).not.toContain("crustdata");
    }
  });

  it("is the same synthetic run the server returns for a synthetic-mode code", async () => {
    const run = await runSyntheticPipeline("synthetic");
    if (run.kind !== "ok") throw new Error("expected a synthetic run");
    expect(fixtures.success.results).toEqual(toLiveResultsDto(run.result, { mode: "synthetic", model: "fake" }));
  });

  it("lead with the two synthetic notices and say they are a preview, not a live result", () => {
    expect(fixtures.success.notices).toEqual([...SYNTHETIC_NOTICES, PREVIEW_NOTICE]);
    expect(fixtures.partial.notices).toEqual([...SYNTHETIC_NOTICES, PREVIEW_NOTICE, PARTIAL_PREVIEW_NOTICE]);
    expect(PREVIEW_NOTICE).toMatch(/synthetic/i);
    expect(PREVIEW_NOTICE).toMatch(/not a live result/i);
  });

  it("make the injected-number notice true: the claim check suppresses that draft", () => {
    for (const response of [fixtures.success, fixtures.partial]) {
      const { metrics, prospects } = response.results;
      expect(metrics?.outreach_suppressed.company_ids).toContain(DEMO_UNSUPPORTED_NUMBER_COMPANY_ID);
      expect(metrics?.claim_violations_by_code.map((c) => c.code)).toContain("unsupported_number");
      const demo = prospects.find((p) => p.company_id === DEMO_UNSUPPORTED_NUMBER_COMPANY_ID);
      expect(demo?.outreach.state).toBe("suppressed");
    }
  });

  it("carry only runsRemaining as usage, and simulated costs in the results", () => {
    for (const response of [fixtures.success, fixtures.partial]) {
      expect(response.usage).toEqual({ runsRemaining: 2 });
      const { counts, cost } = response.results.run;
      expect(cost.provider_usd).toBeCloseTo(
        counts.searched * SIMULATED_COST_PER_RECORD.search + counts.enriched * SIMULATED_COST_PER_RECORD.enrich,
        10,
      );
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
    for (const field of ["professional_network_url", "primary_domain", "website", "retrieved_at", "record_id", "api_key", "raw", "fact_id"]) {
      expect(json).not.toContain(`"${field}":`);
    }
  });
});
