// Enrichment prioritisation in the improved pipeline: rejected companies and
// companies without a LinkedIn URL are excluded, then "valid" companies are
// enriched before "flagged" ones (each in search order), and only then is
// the cap applied. The result keeps search order. Synthetic fixtures and the
// fake LLM only; no network.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runImprovedPipeline } from "../../src/core/agent/improved-pipeline";
import { runBaselinePipeline } from "../../src/core/agent/pipeline";
import type { BaselineProspect, PipelineResult } from "../../src/core/agent/types";
import { FIXTURE_COMPANIES } from "../../src/core/fixtures/companies";
import type { RawCompany, RunConfig } from "../../src/core/types";
import { EVIDENCE_CONFIG, OPEN_ICP, harness } from "./helpers";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const SEARCH_ORDER = [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010];
const urlOf = (id: number) => FIXTURE_COMPANIES.find((c) => c.crustdata_company_id === id)!.professional_network_url;
const idsOf = (result: PipelineResult) => result.prospects.map((p) => p.raw.crustdata_company_id);
const byId = (result: PipelineResult) =>
  Object.fromEntries(result.prospects.map((p) => [p.raw.crustdata_company_id, p])) as Record<number, BaselineProspect>;
const config = (overrides: Partial<RunConfig> = {}): RunConfig => ({ ...EVIDENCE_CONFIG, ...overrides });

describe("improved enrichment prioritisation", () => {
  it("requests valid companies first, then flagged, and keeps search order in the result", async () => {
    const h = harness(EVIDENCE_CONFIG);
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });

    // Regression: exact request order at a cap of five.
    expect(h.provider.enrichCalls).toHaveLength(1);
    expect(h.provider.enrichCalls[0]).toEqual([1001, 1004, 1007, 1002, 1003].map(urlOf));
    expect(result.metrics?.enrichment.requested.company_ids).toEqual([1001, 1004, 1007, 1002, 1003]);

    // The earlier duplicate 1005 takes no slot; 1010 is not eligible.
    expect(h.provider.enrichCalls[0]).not.toContain(urlOf(1005));
    expect(result.metrics?.enrichment.eligible.company_ids).not.toContain(1010);
    expect(result.metrics?.enrichment.eligible.company_ids).not.toContain(1005);
    expect(byId(result)[1005].enrichment.status).toBe("skipped_ineligible");
    expect(byId(result)[1010].enrichment.status).toBe("skipped_ineligible");

    // Only the selection order changed: the result is still in search order.
    expect(idsOf(result)).toEqual(SEARCH_ORDER);
    expect(result.metrics?.enrichment.enriched.company_ids).toEqual([1001, 1002, 1003, 1004, 1007]);
    expect(byId(result)[1006].enrichment.status).toBe("skipped_budget");

    // The priority order is on the deduplicate span too.
    const dedupe = h.roots[0].children.find((s) => s.name === "deduplicate")!;
    expect(dedupe.attributes["enrichment.priority_ids"]).toEqual([1001, 1004, 1007, 1002, 1003, 1006, 1008, 1009]);
  });

  it("attaches every enriched record and outcome to its own company", async () => {
    // Mark each enriched record with its id, and drop 1007 from the response.
    const h = harness(EVIDENCE_CONFIG, {
      spy: {
        enrichResult: (r) =>
          r.ok
            ? {
                ...r,
                data: r.data
                  .filter((c) => c.crustdata_company_id !== 1007)
                  .map((c) => ({ ...c, description: `enriched record for ${c.crustdata_company_id}` })),
              }
            : r,
      },
    });
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const p = byId(result);

    for (const id of [1001, 1002, 1003, 1004]) {
      expect(p[id].enrichment.status).toBe("enriched");
      expect(p[id].raw.crustdata_company_id).toBe(id);
      expect(p[id].raw.description).toBe(`enriched record for ${id}`);
    }
    expect(p[1007].enrichment.status).toBe("not_returned");
    expect(p[1007].raw.source).toBe("search");
    expect(p[1006].raw.description).toBeUndefined();
    expect(result.metrics?.enrichment.requested.company_ids).toEqual([1001, 1004, 1007, 1002, 1003]);
    expect(result.metrics?.enrichment.enriched.company_ids).toEqual([1001, 1002, 1003, 1004]);
    expect(idsOf(result)).toEqual(SEARCH_ORDER);
  });

  it("marks a failed enrich call on exactly the requested companies", async () => {
    // Open ICP: search is call 1, enrich call 2.
    const h = harness(EVIDENCE_CONFIG, { fixture: { failures: [{ call_number: 2, category: "timeout" }] } });
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const failed = result.prospects.filter((p) => p.enrichment.status === "failed").map((p) => p.raw.crustdata_company_id);
    expect(failed).toEqual([1001, 1002, 1003, 1004, 1007]);
    expect(byId(result)[1006].enrichment.status).toBe("skipped_budget");
    expect(result.metrics?.enrichment.enriched.count).toBe(0);
  });

  it("excludes a non-rejected company without a LinkedIn URL", async () => {
    // 1001 keeps its name and domain, so it is flagged (missing_linkedin), not rejected.
    const companies: RawCompany[] = FIXTURE_COMPANIES.map((c) =>
      c.crustdata_company_id === 1001 ? { ...c, professional_network_url: "" } : c,
    );
    const h = harness(EVIDENCE_CONFIG, { fixture: { companies } });
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    const p1001 = byId(result)[1001];

    expect(p1001.search_validation?.status).toBe("flagged");
    expect(p1001.search_validation?.issues.map((i) => i.code)).toContain("missing_linkedin");
    expect(p1001.enrichment.status).toBe("skipped_no_linkedin");
    expect(p1001.assessment).toEqual({ status: "not_assessed", reason: "not_enriched" });
    expect(result.metrics?.enrichment.eligible.company_ids).not.toContain(1001);
    expect(result.metrics?.enrichment.requested.company_ids).toEqual([1004, 1007, 1002, 1003, 1006]);
    const dedupe = h.roots[0].children.find((s) => s.name === "deduplicate")!;
    expect(dedupe.attributes["dedupe.no_linkedin_ids"]).toEqual([1001]);
  });

  it("requests every eligible company in priority order when the cap allows", async () => {
    const h = harness(config({ max_enrichments: 10 }));
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: config({ max_enrichments: 10 }) });
    expect(result.metrics?.enrichment.requested.company_ids).toEqual([1001, 1004, 1007, 1002, 1003, 1006, 1008, 1009]);
    expect(result.metrics?.enrichment.eligible.count).toBe(8);
    expect(result.metrics?.enrichment.enriched.count).toBe(8);
    expect(idsOf(result)).toEqual(SEARCH_ORDER);
  });

  it("gives the two slots to valid companies at a cap of two", async () => {
    const h = harness(config({ max_enrichments: 2 }));
    const result = await runImprovedPipeline(OPEN_ICP, h.deps, { config: config({ max_enrichments: 2 }) });
    expect(h.provider.enrichCalls[0]).toEqual([1001, 1004].map(urlOf));
    expect(result.metrics?.enrichment.requested.company_ids).toEqual([1001, 1004]);
  });
});

describe("baseline enrichment selection", () => {
  it("is unchanged: the first companies with a LinkedIn URL, in search order", async () => {
    const h = harness(EVIDENCE_CONFIG);
    const result = await runBaselinePipeline(OPEN_ICP, h.deps, { config: EVIDENCE_CONFIG });
    expect(h.provider.enrichCalls[0]).toEqual([1001, 1002, 1003, 1004, 1005].map(urlOf));
    expect(result.metrics).toBeUndefined();
    expect(idsOf(result)).toEqual(SEARCH_ORDER);
  });
});
