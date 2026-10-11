// The page DTO carries only explicitly selected, serialisable fields: no raw
// company record, source-record detail, prompt, model metadata, trace data or
// credential, even when such data is present upstream.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeLlmClient } from "../../../core/agent/fake-llm";
import { FixtureProvider } from "../../../core/data/fixture-provider";
import { FIXTURE_COMPANIES } from "../../../core/fixtures/companies";
import type { RawCompany } from "../../../core/types";
import { guardrailDemoResponder } from "../_lib/guardrail-demo";
import type { ResultsDto } from "../_lib/presentation";
import { SIMULATED_COST_PER_RECORD, SYNTHETIC_RUN_CONFIG } from "../_lib/synthetic-config";
import { loadSyntheticResults, type SyntheticDependencies } from "../_lib/synthetic-run";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

// Upstream records carrying values that must never reach the browser.
const SECRET = "sk-live-should-never-appear-0123456789";
const tainted: RawCompany[] = FIXTURE_COMPANIES.map(
  (c) => ({ ...c, api_key: SECRET, internal_notes: "internal source detail" }) as RawCompany,
);

async function dto(companies?: readonly RawCompany[]): Promise<ResultsDto> {
  const deps: SyntheticDependencies = {
    createProvider() {
      const provider = new FixtureProvider({
        config: SYNTHETIC_RUN_CONFIG,
        cost_per_record: SIMULATED_COST_PER_RECORD,
        ...(companies ? { companies } : {}),
      });
      return { provider, budget: provider.budget };
    },
    createLlm: () => new FakeLlmClient({ respond: guardrailDemoResponder }),
  };
  const loaded = await loadSyntheticResults(undefined, deps);
  if (loaded.kind !== "ok") throw new Error("expected results");
  return loaded.results;
}

function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe("results DTO", () => {
  it("is plain, serialisable JSON", async () => {
    const results = await dto();
    expect(JSON.parse(JSON.stringify(results))).toEqual(results);
  });

  it("has exactly the expected top-level and prospect fields", async () => {
    const results = await dto();
    expect(Object.keys(results).sort()).toEqual(["issues", "metrics", "mode", "prospects", "run"]);
    expect(Object.keys(results.prospects[0]).sort()).toEqual([
      "assessment",
      "company_id",
      "display_name",
      "enrichment_status",
      "facts",
      "guard",
      "outreach",
      "search_validation_status",
      "validation",
    ]);
    expect(Object.keys(results.prospects[0].facts[0]).sort()).toEqual(["citeable", "claim", "id", "provider", "status"]);
  });

  it("exposes no raw record, source-record, prompt, model or trace fields", async () => {
    const keys = allKeys(await dto());
    for (const forbidden of [
      "raw",
      "professional_network_url",
      "primary_domain",
      "website",
      "logo",
      "retrieved_at",
      "record_id",
      "source",
      "cost_usd",
      "messages",
      "llm_call",
      "trace_id",
      "usage",
      "value",
      "api_key",
      "internal_notes",
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });

  it("does not copy extra fields present on upstream records", async () => {
    const json = JSON.stringify(await dto(tainted));
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain("internal source detail");
  });

  it("states synthetic mode, fixture provenance and zero actual spend", async () => {
    const results = await dto();
    expect(results.mode).toBe("synthetic");
    expect(results.run.fact_provider).toBe("fixture");
    expect(results.run.actual_spend_usd).toBe(0);
    expect(results.run.limits).toMatchObject({ max_search_results: 10, max_enrichments: 5 });
    expect(results.run.simulated_provider_cost_usd.total).toBeGreaterThan(0);
  });

  it("keeps the search order and every company, rejected ones included", async () => {
    const results = await dto();
    expect(results.prospects.map((p) => p.company_id)).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010]);
    const rejected = results.prospects.find((p) => p.company_id === 1010)!;
    expect(rejected).toMatchObject({
      validation: { status: "rejected" },
      assessment: { status: "not_assessed", reason: "rejected" },
      facts: [],
      outreach: { state: "none" },
      display_name: "Company 1010",
    });
  });

  it("shows kept outreach with its cited fact ids, and citeability per fact", async () => {
    const results = await dto();
    const kept = results.prospects.find((p) => p.outreach.state === "kept")!;
    if (kept.outreach.state !== "kept") throw new Error("expected kept outreach");
    expect(kept.outreach.cited_fact_ids.length).toBeGreaterThan(0);
    for (const id of kept.outreach.cited_fact_ids) {
      expect(kept.facts.find((f) => f.id === id)?.citeable).toBe(true);
    }
    // Uncertain facts are marked not citeable (1003's junk website).
    const website = results.prospects.find((p) => p.company_id === 1003)!.facts.find((f) => f.id === "1003:website");
    expect(website).toMatchObject({ status: "uncertain", citeable: false });
  });
});
