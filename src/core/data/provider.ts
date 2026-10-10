// Provider interface: the only way the agent reaches company data. Real and
// fixture providers both implement it. Plain TypeScript only.

import type { RawCompany, RunConfig } from "../types";

// Why a provider call failed.
export type ProviderErrorCategory =
  | "auth_failed"
  | "rate_limited"
  | "timeout"
  | "bad_request"
  | "no_match"
  | "budget_cap_reached"
  | "empty_or_partial";

export interface ProviderError {
  readonly category: ProviderErrorCategory;
  readonly message: string;
}

// Outcome of one provider call. Providers return errors; they do not throw.
export type ProviderResult<T> =
  | {
      readonly ok: true;
      readonly data: T;
      // US dollars this call cost.
      readonly cost_usd: number;
      // Number of upstream API calls made.
      readonly calls: number;
    }
  | { readonly ok: false; readonly error: ProviderError };

// Filters for a company search.
export interface SearchFilters {
  readonly country: string;
  readonly industries: readonly string[];
  readonly employee_count_ranges: readonly string[];
}

export interface CompanyProvider {
  autocompleteIndustry(query: string): Promise<ProviderResult<readonly string[]>>;
  searchCompanies(
    filters: SearchFilters,
    limit: number,
  ): Promise<ProviderResult<readonly RawCompany[]>>;
  enrichCompanies(
    linkedin_urls: readonly string[],
  ): Promise<ProviderResult<readonly RawCompany[]>>;
}

// What a BudgetGuard has used so far.
export interface BudgetSnapshot {
  readonly cost_usd: number;
  readonly searched: number;
  readonly enriched: number;
}

// Tracks spend against the run's caps. Providers must check it before every
// paid call and return budget_cap_reached instead of calling when it says no.
export class BudgetGuard {
  private readonly max_search_results: number;
  private readonly max_enrichments: number;
  private cost_usd = 0;
  private searched = 0;
  private enriched = 0;

  constructor(config: Pick<RunConfig, "max_search_results" | "max_enrichments">) {
    this.max_search_results = config.max_search_results;
    this.max_enrichments = config.max_enrichments;
  }

  // True if searching `limit` more companies stays within the cap.
  canSearch(limit: number): boolean {
    return limit >= 0 && this.searched + limit <= this.max_search_results;
  }

  // True if enriching `count` more companies stays within the cap.
  canEnrich(count: number): boolean {
    return count >= 0 && this.enriched + count <= this.max_enrichments;
  }

  recordSearch(n: number, cost: number): void {
    this.searched += n;
    this.cost_usd += cost;
  }

  recordEnrich(n: number, cost: number): void {
    this.enriched += n;
    this.cost_usd += cost;
  }

  snapshot(): BudgetSnapshot {
    return {
      cost_usd: this.cost_usd,
      searched: this.searched,
      enriched: this.enriched,
    };
  }
}
