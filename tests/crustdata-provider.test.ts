import { describe, expect, it } from "vitest";
import {
  CRUSTDATA_PRICE_PER_ENRICHED_COMPANY_USD as ENRICH_PRICE,
  CRUSTDATA_PRICE_PER_SEARCH_RECORD_USD as SEARCH_PRICE,
  CrustdataProvider,
} from "../src/core/data/crustdata-provider";
import { BudgetGuard } from "../src/core/data/provider";

const KEY = "sk-test-SECRET-123";
const open = { country: "", industries: [], employee_count_ranges: [] };

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
type Reply = { status?: number; json?: unknown; headers?: Record<string, string> } | Error;

// Fake fetch: replies are consumed in order; the last one repeats.
function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn = (async (input: string, init: RequestInit) => {
    calls.push({
      url: String(input),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.json ?? {}), {
      status: reply.status ?? 200,
      headers: reply.headers,
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function make(replies: Reply[], caps = { max_search_results: 100, max_enrichments: 100 }, extra = {}) {
  const f = fakeFetch(replies);
  const waits: number[] = [];
  const budget = new BudgetGuard(caps);
  const provider = new CrustdataProvider({
    api_key: KEY,
    budget,
    fetch: f.fn,
    sleep: async (ms) => {
      waits.push(ms);
    },
    ...extra,
  });
  return { provider, budget, calls: f.calls, waits };
}

function enrichElement(url: string, matches: { score: number; id: number; name?: string }[]) {
  return {
    matched_on: url,
    match_type: "professional_network_profile_url",
    matches: matches.map((m) => ({
      confidence_score: m.score,
      company_data: {
        crustdata_company_id: m.id,
        basic_info: {
          name: m.name ?? `Company ${m.id}`,
          primary_domain: `c${m.id}.example`,
          website: `https://c${m.id}.example`,
          professional_network_url: url,
          employee_count_range: "51-200",
          description: "Invented description",
          company_type: "Privately Held",
          year_founded: 2011,
          logo_permalink: "https://img.example/logo.png",
          status: "operating",
        },
        headcount: { total: 120 },
        locations: {
          city: "Pune",
          state: "MH",
          country: "India",
          street_address: "1 SECRET STREET",
          headquarters: "SECRET HQ",
          all_office_addresses: ["SECRET OFFICE A"],
        },
        taxonomy: {
          professional_network_industry: "Staffing",
          professional_network_specialities: ["hiring", "payroll"],
        },
      },
    })),
  };
}

const searchItem = (id: number) => ({
  crustdata_company_id: id,
  basic_info: {
    name: `Search Co ${id}`,
    primary_domain: `s${id}.example`,
    website: `https://s${id}.example`,
    professional_network_url: `https://www.linkedin.com/company/s${id}`,
    employee_count_range: "11-50",
    logo_permalink: "https://img.example/s.png",
  },
  taxonomy: { professional_network_industry: "Staffing" },
});

describe("autocompleteIndustry", () => {
  it("returns values, costs nothing and sends the right request", async () => {
    const t = make([{ json: { suggestions: [{ value: "Staffing" }, { value: "Staffing and Recruiting" }] } }]);
    const r = await t.provider.autocompleteIndustry("staffing");
    expect(r.ok && r.data).toEqual(["Staffing", "Staffing and Recruiting"]);
    expect(r.ok && r.cost_usd).toBe(0);
    expect(t.budget.snapshot()).toEqual({ cost_usd: 0, searched: 0, enriched: 0 });
    expect(t.calls[0].url).toBe("https://api.crustdata.com/company/search/autocomplete");
    expect(t.calls[0].body).toEqual({
      field: "taxonomy.professional_network_industry",
      query: "staffing",
      limit: 10,
    });
    expect(t.calls[0].headers).toEqual({
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      "x-api-version": "2025-11-01",
    });
  });
});

describe("searchCompanies", () => {
  it("builds the filter body and maps results", async () => {
    const t = make([{ json: { companies: [searchItem(1), searchItem(2)] } }]);
    const r = await t.provider.searchCompanies(
      { country: "India", industries: ["Staffing"], employee_count_ranges: ["11-50", "51-200"] },
      5,
    );
    expect(t.calls[0].body).toMatchObject({
      filters: {
        op: "and",
        conditions: [
          { field: "locations.country", type: "=", value: "India" },
          { field: "taxonomy.professional_network_industry", type: "in", value: ["Staffing"] },
          { field: "basic_info.employee_count_range", type: "in", value: ["11-50", "51-200"] },
        ],
      },
      limit: 5,
    });
    expect(r.ok && r.data[0]).toMatchObject({
      crustdata_company_id: 1,
      name: "Search Co 1",
      primary_domain: "s1.example",
      employee_count_range: "11-50",
      industry: "Staffing",
      logo: "https://img.example/s.png",
      source: "search",
    });
  });

  it("maps a record with every real path non-empty", async () => {
    const t = make([{ json: { companies: [searchItem(9)], next_cursor: "c", total_count: 1 } }]);
    const r = await t.provider.searchCompanies(open, 1);
    expect(r.ok && r.data[0]).toMatchObject({
      crustdata_company_id: 9,
      name: "Search Co 9",
      primary_domain: "s9.example",
      website: "https://s9.example",
      professional_network_url: "https://www.linkedin.com/company/s9",
      employee_count_range: "11-50",
      industry: "Staffing",
      logo: "https://img.example/s.png",
    });
  });

  it("maps a record with only an id and a size range without throwing", async () => {
    const t = make([
      { json: { companies: [{ crustdata_company_id: 5, basic_info: { employee_count_range: "11-50" } }] } },
    ]);
    const r = await t.provider.searchCompanies(open, 1);
    expect(r.ok && r.data[0]).toMatchObject({
      crustdata_company_id: 5,
      employee_count_range: "11-50",
      name: "",
      website: "",
      professional_network_url: "",
      logo: "",
      industry: "",
    });
  });

  it("omits filters when there are no conditions", async () => {
    const t = make([{ json: { companies: [searchItem(1)] } }]);
    await t.provider.searchCompanies(open, 1);
    expect(t.calls[0].body).not.toHaveProperty("filters");
  });

  it("omits sorts from the body by default", async () => {
    const t = make([{ json: { companies: [searchItem(1)] } }]);
    await t.provider.searchCompanies(open, 1);
    expect(t.calls[0].body).not.toHaveProperty("sorts");
  });

  it("sends an explicit search_sort in the body", async () => {
    const t = make([{ json: { companies: [searchItem(1)] } }], undefined, {
      search_sort: { field: "basic_info.name", order: "desc" },
    });
    await t.provider.searchCompanies(open, 1);
    expect(t.calls[0].body.sorts).toEqual([{ field: "basic_info.name", order: "desc" }]);
  });

  it("costs 0.069 per record returned and records spend", async () => {
    const t = make([{ json: { companies: [searchItem(1), searchItem(2), searchItem(3)] } }]);
    const r = await t.provider.searchCompanies(open, 10);
    expect(r.ok && r.cost_usd).toBeCloseTo(3 * SEARCH_PRICE);
    expect(t.budget.snapshot().searched).toBe(3);
    expect(t.budget.snapshot().cost_usd).toBeCloseTo(3 * SEARCH_PRICE);
  });

  it("returns no_match for an empty result", async () => {
    const t = make([{ json: { companies: [] } }]);
    const r = await t.provider.searchCompanies(open, 3);
    expect(!r.ok && r.error.category).toBe("no_match");
    expect(t.budget.snapshot().cost_usd).toBe(0);
  });

  it("never throws on null or missing fields", async () => {
    const t = make([
      { json: { companies: [{}, null, { basic_info: null, taxonomy: { professional_network_industry: null } }] } },
    ]);
    const r = await t.provider.searchCompanies(open, 5);
    expect(r.ok && r.data.length).toBe(3);
    expect(r.ok && r.data[0].name).toBe("");
  });
});

describe("enrichCompanies", () => {
  const url = "https://www.linkedin.com/company/a";

  it("maps fields and costs 0.60 per matched company", async () => {
    const t = make([{ json: [enrichElement(url, [{ score: 0.9, id: 7 }])] }]);
    const r = await t.provider.enrichCompanies([url]);
    expect(t.calls[0].url).toBe("https://api.crustdata.com/company/enrich");
    expect(t.calls[0].body).toEqual({
      fields: ["basic_info", "headcount", "locations", "taxonomy"],
      professional_network_profile_urls: [url],
    });
    expect(r.ok && r.data[0]).toMatchObject({
      crustdata_company_id: 7,
      name: "Company 7",
      primary_domain: "c7.example",
      industry: "Staffing",
      logo: "https://img.example/logo.png",
      description: "Invented description",
      legal_type: "Privately Held",
      founded_year: 2011,
      latest_headcount: 120,
      location: { city: "Pune", state: "MH", country: "India" },
      specialities: ["hiring", "payroll"],
      source: "enrich",
    });
    expect(r.ok && r.data[0].revenue_range).toBeUndefined();
    expect(r.ok && r.cost_usd).toBeCloseTo(ENRICH_PRICE);
    expect(t.budget.snapshot().enriched).toBe(1);
  });

  it("never exposes street_address, headquarters or all_office_addresses", async () => {
    const t = make([{ json: [enrichElement(url, [{ score: 1, id: 7 }])] }]);
    const r = await t.provider.enrichCompanies([url]);
    const out = JSON.stringify(r);
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("street_address");
    expect(out).not.toContain("all_office_addresses");
    expect(out).not.toContain("headquarters");
  });

  it("chooses the highest-confidence match", async () => {
    const t = make([
      { json: [enrichElement(url, [{ score: 0.2, id: 1 }, { score: 0.95, id: 2 }, { score: 0.5, id: 3 }])] },
    ]);
    const r = await t.provider.enrichCompanies([url]);
    expect(r.ok && r.data.map((c) => c.crustdata_company_id)).toEqual([2]);
  });

  it("returns only matched records for a partial result and charges for those", async () => {
    const t = make([
      {
        json: [
          enrichElement(url, [{ score: 0.9, id: 1 }]),
          { matched_on: "x", match_type: "y", matches: [] },
        ],
      },
    ]);
    const r = await t.provider.enrichCompanies([url, "https://www.linkedin.com/company/none"]);
    expect(r.ok && r.data.length).toBe(1);
    expect(r.ok && r.cost_usd).toBeCloseTo(ENRICH_PRICE);
    expect(t.budget.snapshot().enriched).toBe(1);
  });

  it("returns no_match when nothing matched", async () => {
    const t = make([{ json: [{ matched_on: "x", match_type: "y", matches: [] }] }]);
    const r = await t.provider.enrichCompanies([url]);
    expect(!r.ok && r.error.category).toBe("no_match");
    expect(t.budget.snapshot().cost_usd).toBe(0);
  });

  it("chunks 30 URLs into 25 + 5", async () => {
    const urls = Array.from({ length: 30 }, (_, i) => `https://www.linkedin.com/company/c${i}`);
    const reply = (list: string[]) => ({
      json: list.map((u, i) => enrichElement(u, [{ score: 1, id: i + 1 }])),
    });
    const t = make([reply(urls.slice(0, 25)), reply(urls.slice(25))]);
    const r = await t.provider.enrichCompanies(urls);
    expect(t.calls.map((c) => (c.body.professional_network_profile_urls as string[]).length)).toEqual([25, 5]);
    expect(r.ok && r.data.length).toBe(30);
    expect(r.ok && r.calls).toBe(2);
    expect(r.ok && r.cost_usd).toBeCloseTo(30 * ENRICH_PRICE);
  });

  it("never throws on null or missing fields", async () => {
    const t = make([
      {
        json: [
          { matches: [{ confidence_score: null, company_data: {} }] },
          { matches: [{ company_data: { basic_info: { year_founded: null }, headcount: { total: null }, locations: null } }] },
          null,
          { matches: null },
        ],
      },
    ]);
    const r = await t.provider.enrichCompanies(["a", "b", "c", "d"]);
    expect(r.ok && r.data.length).toBe(2);
    expect(r.ok && r.data[1]).not.toHaveProperty("founded_year");
    expect(r.ok && r.data[1]).not.toHaveProperty("latest_headcount");
    expect(r.ok && r.data[1]).not.toHaveProperty("location");
  });
});

describe("errors", () => {
  it.each([401, 403])("maps %i to auth_failed without retrying", async (status) => {
    const t = make([{ status, json: { detail: "bad key " + KEY } }]);
    const r = await t.provider.searchCompanies(open, 1);
    expect(!r.ok && r.error.category).toBe("auth_failed");
    expect(t.calls.length).toBe(1);
  });

  it.each([400, 422])("maps %i to bad_request", async (status) => {
    const t = make([{ status }]);
    const r = await t.provider.searchCompanies(open, 1);
    expect(!r.ok && r.error.category).toBe("bad_request");
    expect(t.calls.length).toBe(1);
  });

  it("retries a 429 with 1s then 2s waits and then succeeds", async () => {
    const t = make([{ status: 429 }, { status: 429 }, { json: { companies: [searchItem(1)] } }]);
    const r = await t.provider.searchCompanies(open, 1);
    expect(r.ok).toBe(true);
    expect(t.calls.length).toBe(3);
    expect(t.waits).toEqual([1000, 2000]);
    expect(r.ok && r.calls).toBe(3);
  });

  it("honours Retry-After", async () => {
    const t = make([{ status: 429, headers: { "Retry-After": "7" } }, { json: { companies: [searchItem(1)] } }]);
    await t.provider.searchCompanies(open, 1);
    expect(t.waits).toEqual([7000]);
  });

  it("returns rate_limited once retries are exhausted, with no spend", async () => {
    const t = make([{ status: 429 }]);
    const r = await t.provider.searchCompanies(open, 1);
    expect(!r.ok && r.error.category).toBe("rate_limited");
    expect(t.calls.length).toBe(3);
    expect(t.budget.snapshot().cost_usd).toBe(0);
  });

  it("maps 5xx to timeout after retrying", async () => {
    const t = make([{ status: 503 }]);
    const r = await t.provider.searchCompanies(open, 1);
    expect(!r.ok && r.error.category).toBe("timeout");
    expect(t.calls.length).toBe(3);
  });

  it("maps network errors to timeout", async () => {
    const t = make([new Error(`connect failed to https://api.crustdata.com with ${KEY}`)]);
    const r = await t.provider.searchCompanies(open, 1);
    expect(!r.ok && r.error.category).toBe("timeout");
  });

  it("never puts the key, body or URLs in an error message", async () => {
    const url = "https://www.linkedin.com/company/private-slug";
    for (const reply of [
      { status: 401, json: { detail: KEY } },
      { status: 429, json: { detail: KEY } },
      { status: 500, json: { detail: KEY } },
      { status: 400, json: { detail: KEY } },
      new Error(KEY),
    ] as Reply[]) {
      const t = make([reply]);
      const results = [
        await t.provider.autocompleteIndustry("q"),
        await t.provider.searchCompanies(open, 1),
        await t.provider.enrichCompanies([url]),
      ];
      for (const r of results) {
        expect(r.ok).toBe(false);
        const message = !r.ok ? r.error.message : "";
        expect(message).not.toContain(KEY);
        expect(message).not.toContain("private-slug");
        expect(message).not.toContain("Bearer");
      }
    }
  });
});

describe("budget", () => {
  it("refuses a search over the cap without calling fetch", async () => {
    const t = make([{ json: {} }], { max_search_results: 2, max_enrichments: 5 });
    const r = await t.provider.searchCompanies(open, 3);
    expect(!r.ok && r.error.category).toBe("budget_cap_reached");
    expect(t.calls.length).toBe(0);
  });

  it("refuses an enrich over the cap without calling fetch", async () => {
    const t = make([{ json: [] }], { max_search_results: 5, max_enrichments: 1 });
    const r = await t.provider.enrichCompanies(["a", "b"]);
    expect(!r.ok && r.error.category).toBe("budget_cap_reached");
    expect(t.calls.length).toBe(0);
  });
});
