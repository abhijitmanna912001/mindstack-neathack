// Deterministic CompanyProvider backed by the synthetic fixtures. No network.

import { FIXTURE_COMPANIES } from "../fixtures/companies";
import type { RawCompany, RunConfig } from "../types";
import { normalizeLinkedInUrl } from "./normalize";
import {
  BudgetGuard,
  type CompanyProvider,
  type ProviderErrorCategory,
  type ProviderResult,
  type SearchFilters,
} from "./provider";

// Make the Nth call (1-based, counted across all three methods) fail.
export interface InjectedFailure {
  readonly call_number: number;
  readonly category: ProviderErrorCategory;
  readonly message?: string;
}

export interface FixtureProviderOptions {
  readonly config: Pick<RunConfig, "max_search_results" | "max_enrichments">;
  // Cost of each call: a fixed amount, or a function of the 1-based call
  // number. Default 0.
  readonly cost_usd?: number | ((call_number: number) => number);
  // Price per record, used only when cost_usd is not given: a successful call
  // costs the price times the records returned (search) or matched (enrich).
  readonly cost_per_record?: { readonly search?: number; readonly enrich?: number };
  readonly failures?: readonly InjectedFailure[];
  // Defaults to the synthetic fixtures.
  readonly companies?: readonly RawCompany[];
}

export class FixtureProvider implements CompanyProvider {
  readonly budget: BudgetGuard;
  private readonly cost_usd: number | ((call_number: number) => number);
  private readonly cost_per_record: { readonly search: number; readonly enrich: number };
  private readonly per_record_pricing: boolean;
  private readonly failures: readonly InjectedFailure[];
  private readonly companies: readonly RawCompany[];
  private call_count = 0;

  constructor(options: FixtureProviderOptions) {
    this.budget = new BudgetGuard(options.config);
    this.cost_usd = options.cost_usd ?? 0;
    this.per_record_pricing =
      options.cost_usd === undefined && options.cost_per_record !== undefined;
    this.cost_per_record = {
      search: options.cost_per_record?.search ?? 0,
      enrich: options.cost_per_record?.enrich ?? 0,
    };
    this.failures = options.failures ?? [];
    this.companies = options.companies ?? FIXTURE_COMPANIES;
  }

  // Number of calls made so far, including failed ones.
  get calls_made(): number {
    return this.call_count;
  }

  private nextCall(): { n: number; cost: number; failure?: InjectedFailure } {
    this.call_count += 1;
    const n = this.call_count;
    const cost = typeof this.cost_usd === "function" ? this.cost_usd(n) : this.cost_usd;
    return { n, cost, failure: this.failures.find((f) => f.call_number === n) };
  }

  async autocompleteIndustry(query: string): Promise<ProviderResult<readonly string[]>> {
    const { failure } = this.nextCall();
    if (failure) return fail(failure.category, failure.message);
    const q = query.trim().toLowerCase();
    const matches = [
      ...new Set(this.companies.map((c) => c.industry).filter((i) => i !== "")),
    ].filter((i) => i.toLowerCase().includes(q));
    if (q === "" || matches.length === 0) {
      return fail("no_match", `no industry matches "${query}"`);
    }
    // Autocomplete is free and outside the search/enrich caps.
    return { ok: true, data: matches, cost_usd: 0, calls: 1 };
  }

  async searchCompanies(
    filters: SearchFilters,
    limit: number,
  ): Promise<ProviderResult<readonly RawCompany[]>> {
    if (!this.budget.canSearch(limit)) {
      return fail("budget_cap_reached", "search cap would be exceeded");
    }
    const { cost, failure } = this.nextCall();
    if (failure) return fail(failure.category, failure.message);
    const industries = filters.industries.map((i) => i.toLowerCase());
    const found = this.companies
      .filter((c) => {
        if (industries.length > 0 && !industries.includes(c.industry.toLowerCase())) {
          return false;
        }
        if (
          filters.employee_count_ranges.length > 0 &&
          !filters.employee_count_ranges.includes(c.employee_count_range)
        ) {
          return false;
        }
        // Records with no location pass: the fixtures rarely carry one.
        const country = c.location?.country;
        return !country || !filters.country || country.toLowerCase() === filters.country.toLowerCase();
      })
      .slice(0, limit)
      .map((c): RawCompany => ({ ...c, source: "search" }));
    if (found.length === 0) return fail("no_match", "no companies match the filters");
    const total = this.per_record_pricing ? this.cost_per_record.search * found.length : cost;
    this.budget.recordSearch(found.length, total);
    return { ok: true, data: found, cost_usd: total, calls: 1 };
  }

  async enrichCompanies(
    linkedin_urls: readonly string[],
  ): Promise<ProviderResult<readonly RawCompany[]>> {
    if (!this.budget.canEnrich(linkedin_urls.length)) {
      return fail("budget_cap_reached", "enrichment cap would be exceeded");
    }
    const { cost, failure } = this.nextCall();
    if (failure) return fail(failure.category, failure.message);
    const wanted = new Set(linkedin_urls.map(normalizeLinkedInUrl));
    const found = this.companies.filter(
      (c) => c.professional_network_url !== "" && wanted.has(normalizeLinkedInUrl(c.professional_network_url)),
    );
    // Unmatched URLs are simply absent from data; if none match, no_match.
    if (found.length === 0) return fail("no_match", "no fixture matches the LinkedIn URLs");
    const total = this.per_record_pricing ? this.cost_per_record.enrich * found.length : cost;
    this.budget.recordEnrich(found.length, total);
    return { ok: true, data: found, cost_usd: total, calls: 1 };
  }
}

function fail(category: ProviderErrorCategory, message?: string): ProviderResult<never> {
  return { ok: false, error: { category, message: message ?? category } };
}
