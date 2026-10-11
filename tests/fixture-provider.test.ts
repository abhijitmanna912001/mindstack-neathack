import { describe, expect, it } from "vitest";
import { FixtureProvider } from "../src/core/data/fixture-provider";
import { BudgetGuard } from "../src/core/data/provider";
import { FIXTURE_COMPANIES } from "../src/core/fixtures/companies";

const open = { country: "", industries: [], employee_count_ranges: [] };

function make(max_search_results = 100, max_enrichments = 15, extra = {}) {
  return new FixtureProvider({ config: { max_search_results, max_enrichments }, ...extra });
}

describe("BudgetGuard", () => {
  it("refuses calls that would exceed a cap", () => {
    const g = new BudgetGuard({ max_search_results: 5, max_enrichments: 2 });
    expect(g.canSearch(5)).toBe(true);
    expect(g.canSearch(6)).toBe(false);
    g.recordSearch(3, 0.1);
    expect(g.canSearch(3)).toBe(false);
    g.recordEnrich(2, 0.2);
    expect(g.canEnrich(1)).toBe(false);
    expect(g.snapshot()).toEqual({ cost_usd: expect.closeTo(0.3), searched: 3, enriched: 2 });
  });
});

describe("FixtureProvider caps", () => {
  it("returns budget_cap_reached without making the call", async () => {
    const p = make(3, 1);
    const first = await p.searchCompanies(open, 3);
    expect(first.ok && first.data.length).toBe(3);
    const second = await p.searchCompanies(open, 1);
    expect(!second.ok && second.error.category).toBe("budget_cap_reached");
    const urls = FIXTURE_COMPANIES.slice(0, 2).map((c) => c.professional_network_url);
    const enrich = await p.enrichCompanies(urls);
    expect(!enrich.ok && enrich.error.category).toBe("budget_cap_reached");
    expect(p.calls_made).toBe(1);
  });

  it("tracks simulated cost", async () => {
    const p = make(100, 15, { cost_usd: 0.5 });
    const r = await p.searchCompanies(open, 2);
    expect(r.ok && r.cost_usd).toBe(0.5);
    expect(p.budget.snapshot()).toEqual({ cost_usd: 0.5, searched: 2, enriched: 0 });
  });

  it("costs nothing by default", async () => {
    const r = await make().searchCompanies(open, 2);
    expect(r.ok && r.cost_usd).toBe(0);
  });
});

describe("FixtureProvider cost_per_record", () => {
  const prices = { search: 0.1, enrich: 0.5 };

  it("charges per record returned by search", async () => {
    const p = make(100, 15, { cost_per_record: prices });
    const r = await p.searchCompanies(open, 3);
    expect(r.ok && r.cost_usd).toBeCloseTo(0.3);
    expect(p.budget.snapshot().cost_usd).toBeCloseTo(0.3);
  });

  it("charges per record matched by enrich, not requested", async () => {
    const p = make(100, 15, { cost_per_record: prices });
    const known = FIXTURE_COMPANIES[0].professional_network_url;
    const r = await p.enrichCompanies([known, "https://www.linkedin.com/company/nope"]);
    expect(r.ok && r.cost_usd).toBeCloseTo(0.5);
  });

  it("treats a missing price as free", async () => {
    const r = await make(100, 15, { cost_per_record: { enrich: 1 } }).searchCompanies(open, 2);
    expect(r.ok && r.cost_usd).toBe(0);
  });

  it("charges nothing for failed calls", async () => {
    const p = make(100, 15, {
      cost_per_record: prices,
      failures: [{ call_number: 1, category: "rate_limited" }],
    });
    expect((await p.searchCompanies(open, 2)).ok).toBe(false);
    expect(p.budget.snapshot().cost_usd).toBe(0);
  });

  it("lets cost_usd take precedence", async () => {
    const p = make(100, 15, { cost_usd: 0.5, cost_per_record: prices });
    const r = await p.searchCompanies(open, 3);
    expect(r.ok && r.cost_usd).toBe(0.5);
  });
});

describe("FixtureProvider failure injection", () => {
  it("fails only the Nth call, then recovers", async () => {
    const p = make(100, 15, { failures: [{ call_number: 2, category: "rate_limited" }] });
    expect((await p.searchCompanies(open, 2)).ok).toBe(true);
    const failed = await p.searchCompanies(open, 2);
    expect(!failed.ok && failed.error.category).toBe("rate_limited");
    expect((await p.searchCompanies(open, 2)).ok).toBe(true);
    // The failed call spent nothing.
    expect(p.budget.snapshot().searched).toBe(4);
  });
});

describe("FixtureProvider enrich", () => {
  it("returns matching records, tolerant of URL formatting", async () => {
    const target = FIXTURE_COMPANIES[0];
    const url = target.professional_network_url.toUpperCase() + "/";
    const r = await make().enrichCompanies([url]);
    expect(r.ok && r.data.map((c) => c.crustdata_company_id)).toEqual([target.crustdata_company_id]);
  });

  it("returns no_match for unknown URLs", async () => {
    const r = await make().enrichCompanies(["https://www.linkedin.com/company/does-not-exist"]);
    expect(!r.ok && r.error.category).toBe("no_match");
  });

  it("omits unknown URLs from a partial match", async () => {
    const known = FIXTURE_COMPANIES[0].professional_network_url;
    const r = await make().enrichCompanies([known, "https://www.linkedin.com/company/nope"]);
    expect(r.ok && r.data.length).toBe(1);
  });
});

describe("FixtureProvider autocomplete", () => {
  it("matches industries and reports no_match", async () => {
    const p = make();
    const hit = await p.autocompleteIndustry("soft");
    expect(hit.ok && hit.data).toContain("Software");
    const miss = await p.autocompleteIndustry("zzz");
    expect(!miss.ok && miss.error.category).toBe("no_match");
  });
});
