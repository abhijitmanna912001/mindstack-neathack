// Live Crustdata smoke test. SPENDS REAL MONEY (about $0.81).
//
//   CRUSTDATA_API_KEY=... npx tsx scripts/crustdata-smoke.ts --confirm-spend
//
// Prints only counts, costs and per-field non-empty counts. Never prints
// names, domains, URLs or addresses.

import { CrustdataProvider } from "../src/core/data/crustdata-provider";
import { BudgetGuard } from "../src/core/data/provider";
import type { RawCompany } from "../src/core/types";

const FIELDS = [
  "crustdata_company_id",
  "name",
  "primary_domain",
  "website",
  "professional_network_url",
  "employee_count_range",
  "industry",
  "logo",
  "description",
  "founded_year",
  "legal_type",
  "latest_headcount",
  "revenue_range",
  "location",
  "specialities",
  "linkedin_followers",
] as const;

function nonEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function report(label: string, records: readonly RawCompany[]): void {
  console.log(`${label}: ${records.length} record(s)`);
  for (const field of FIELDS) {
    const n = records.filter((r) => nonEmpty((r as unknown as Record<string, unknown>)[field])).length;
    console.log(`  ${field}: ${n}/${records.length}`);
  }
}

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm-spend")) {
    console.log("Refusing to run: this spends real money (about $0.81). Pass --confirm-spend.");
    process.exit(1);
  }
  const api_key = process.env.CRUSTDATA_API_KEY;
  if (!api_key) {
    console.log("CRUSTDATA_API_KEY is not set.");
    process.exit(1);
  }

  const budget = new BudgetGuard({ max_search_results: 3, max_enrichments: 1 });
  const provider = new CrustdataProvider({ api_key, budget });

  const industries = await provider.autocompleteIndustry("staffing");
  if (!industries.ok) {
    console.log(`autocomplete failed: ${industries.error.category} (${industries.error.message})`);
    process.exit(1);
  }
  console.log(`autocomplete: ${industries.data.length} suggestion(s), cost $${industries.cost_usd}`);

  const search = await provider.searchCompanies(
    {
      country: "India",
      industries: industries.data.slice(0, 1),
      employee_count_ranges: ["11-50", "51-200"],
    },
    3,
  );
  if (!search.ok) {
    console.log(`search failed: ${search.error.category} (${search.error.message})`);
    process.exit(1);
  }
  console.log(`search: cost $${search.cost_usd.toFixed(3)}, ${search.calls} call(s)`);
  report("search results", search.data);

  const target = search.data.find((c) => c.professional_network_url !== "");
  if (!target) {
    console.log("no search result has a LinkedIn URL; skipping enrich");
  } else {
    const enrich = await provider.enrichCompanies([target.professional_network_url]);
    if (!enrich.ok) {
      console.log(`enrich failed: ${enrich.error.category} (${enrich.error.message})`);
    } else {
      console.log(`enrich: cost $${enrich.cost_usd.toFixed(3)}, ${enrich.calls} call(s)`);
      report("enrich results", enrich.data);
    }
  }

  const snap = budget.snapshot();
  console.log(
    `total: $${snap.cost_usd.toFixed(3)}, searched ${snap.searched}, enriched ${snap.enriched}`,
  );
}

main().catch(() => {
  console.log("smoke test crashed");
  process.exit(1);
});
