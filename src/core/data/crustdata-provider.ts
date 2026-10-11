// Real CompanyProvider backed by the Crustdata HTTP API. Mirrors the
// FixtureProvider's semantics: BudgetGuard is checked before every paid call,
// spend is recorded after success, enrich results are partial, and a call with
// no results is no_match. Providers return errors; they do not throw.
//
// Error messages are deliberately generic (status code and category only).
// They never contain the response body, the URL list or any header.

import type { RawCompany, RawLocation } from "../types";
import {
  type BudgetGuard,
  type CompanyProvider,
  type ProviderErrorCategory,
  type ProviderResult,
  type SearchFilters,
} from "./provider";

// Measured on our account (Oct 10-11, 2026, five measurements). Unmatched
// enrichments are assumed free (unverified).
export const CRUSTDATA_PRICE_PER_SEARCH_RECORD_USD = 0.069;
export const CRUSTDATA_PRICE_PER_ENRICHED_COMPANY_USD = 0.6;

const API_VERSION = "2025-11-01";
const ENRICH_CHUNK_SIZE = 25;
const MAX_RETRY_AFTER_MS = 60_000;

const SEARCH_FIELDS = [
  "crustdata_company_id",
  "basic_info.logo_permalink",
  "basic_info.name",
  "basic_info.primary_domain",
  "basic_info.website",
  "basic_info.professional_network_url",
  "basic_info.employee_count_range",
  "taxonomy.professional_network_industry",
];

const ENRICH_FIELD_GROUPS = ["basic_info", "headcount", "locations", "taxonomy"];

export interface CrustdataProviderOptions {
  readonly api_key: string;
  readonly budget: BudgetGuard;
  // Default https://api.crustdata.com
  readonly base_url?: string;
  // Default global fetch.
  readonly fetch?: typeof fetch;
  // Per-attempt timeout. Default 30000.
  readonly timeout_ms?: number;
  // Retries after the first attempt for 429 / 5xx / network errors. Default 2.
  readonly max_retries?: number;
  // Wait function used between retries. Default setTimeout. Mainly for tests.
  readonly sleep?: (ms: number) => Promise<void>;
  // Optional sort for searches. Default null, which omits "sorts" from the
  // request body. Live tests showed that sorting by basic_info.name ascending
  // returns the sparsest records first (empty name, domain, website and
  // LinkedIn URL), while an unsorted search returns complete records.
  readonly search_sort?: { readonly field: string; readonly order: "asc" | "desc" } | null;
}

type Failure = { readonly ok: false; readonly error: { readonly category: ProviderErrorCategory; readonly message: string } };
type Json = unknown;

export class CrustdataProvider implements CompanyProvider {
  readonly budget: BudgetGuard;
  private readonly api_key: string;
  private readonly base_url: string;
  private readonly fetch_fn: typeof fetch;
  private readonly timeout_ms: number;
  private readonly max_retries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly search_sort: { readonly field: string; readonly order: "asc" | "desc" } | null;

  constructor(options: CrustdataProviderOptions) {
    this.api_key = options.api_key;
    this.budget = options.budget;
    this.base_url = (options.base_url ?? "https://api.crustdata.com").replace(/\/+$/, "");
    this.fetch_fn = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeout_ms = options.timeout_ms ?? 30_000;
    this.max_retries = options.max_retries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.search_sort = options.search_sort ?? null;
  }

  async autocompleteIndustry(query: string): Promise<ProviderResult<readonly string[]>> {
    const res = await this.post("/company/search/autocomplete", {
      field: "taxonomy.professional_network_industry",
      query,
      limit: 10,
    });
    if (!res.ok) return res;
    const raw = asRecord(res.json)?.suggestions;
    const values = (Array.isArray(raw) ? raw : [])
      .map((s) => str(asRecord(s)?.value))
      .filter((v) => v !== "");
    if (values.length === 0) return fail("no_match", "no industry suggestions");
    // Autocomplete is free and outside the search/enrich caps.
    return { ok: true, data: values, cost_usd: 0, calls: res.calls };
  }

  async searchCompanies(
    filters: SearchFilters,
    limit: number,
  ): Promise<ProviderResult<readonly RawCompany[]>> {
    if (!this.budget.canSearch(limit)) {
      return fail("budget_cap_reached", "search cap would be exceeded");
    }
    const conditions: Record<string, unknown>[] = [];
    if (filters.country !== "") {
      conditions.push({ field: "locations.country", type: "=", value: filters.country });
    }
    if (filters.industries.length > 0) {
      conditions.push({
        field: "taxonomy.professional_network_industry",
        type: "in",
        value: filters.industries,
      });
    }
    if (filters.employee_count_ranges.length > 0) {
      conditions.push({
        field: "basic_info.employee_count_range",
        type: "in",
        value: filters.employee_count_ranges,
      });
    }
    const body: Record<string, unknown> = {
      fields: SEARCH_FIELDS,
      limit,
    };
    if (this.search_sort !== null) {
      body.sorts = [{ field: this.search_sort.field, order: this.search_sort.order }];
    }
    if (conditions.length > 0) body.filters = { op: "and", conditions };

    const res = await this.post("/company/search", body);
    if (!res.ok) return res;
    const now = new Date().toISOString();
    const found = extractList(res.json)
      .slice(0, Math.max(limit, 0))
      .map((item) => mapSearchItem(item, now));
    if (found.length === 0) return fail("no_match", "no companies match the filters");
    const total = CRUSTDATA_PRICE_PER_SEARCH_RECORD_USD * found.length;
    const data = found.map((c): RawCompany => ({ ...c, cost_usd: CRUSTDATA_PRICE_PER_SEARCH_RECORD_USD }));
    this.budget.recordSearch(found.length, total);
    return { ok: true, data, cost_usd: total, calls: res.calls };
  }

  async enrichCompanies(
    linkedin_urls: readonly string[],
  ): Promise<ProviderResult<readonly RawCompany[]>> {
    if (!this.budget.canEnrich(linkedin_urls.length)) {
      return fail("budget_cap_reached", "enrichment cap would be exceeded");
    }
    const matched: RawCompany[] = [];
    let cost = 0;
    let calls = 0;
    let first_failure: Failure | undefined;

    for (let i = 0; i < linkedin_urls.length; i += ENRICH_CHUNK_SIZE) {
      const chunk = linkedin_urls.slice(i, i + ENRICH_CHUNK_SIZE);
      if (!this.budget.canEnrich(chunk.length)) {
        first_failure ??= fail("budget_cap_reached", "enrichment cap would be exceeded");
        break;
      }
      const res = await this.post("/company/enrich", {
        fields: ENRICH_FIELD_GROUPS,
        professional_network_profile_urls: chunk,
      });
      calls += res.calls;
      if (!res.ok) {
        first_failure ??= res;
        break;
      }
      const now = new Date().toISOString();
      const records = (Array.isArray(res.json) ? res.json : [])
        .map((element) => mapEnrichElement(element, now))
        .filter((c): c is RawCompany => c !== undefined);
      const chunk_cost = CRUSTDATA_PRICE_PER_ENRICHED_COMPANY_USD * records.length;
      this.budget.recordEnrich(records.length, chunk_cost);
      matched.push(...records);
      cost += chunk_cost;
    }

    // Partial results win over a later chunk's failure, like a partial match.
    if (matched.length > 0) return { ok: true, data: matched, cost_usd: cost, calls };
    return first_failure ?? fail("no_match", "no companies matched the LinkedIn URLs");
  }

  // One POST with retries on 429, 5xx and network errors.
  private async post(
    path: string,
    body: unknown,
  ): Promise<{ ok: true; json: Json; calls: number } | (Failure & { calls: number })> {
    let calls = 0;
    for (let attempt = 0; ; attempt++) {
      calls += 1;
      const outcome = await this.attempt(path, body);
      if (outcome.kind === "ok") return { ok: true, json: outcome.json, calls };
      const failure = { ...fail(outcome.category, outcome.message), calls };
      if (!outcome.retryable || attempt >= this.max_retries) return failure;
      await this.sleep(outcome.retry_after_ms ?? 1000 * 2 ** attempt);
    }
  }

  private async attempt(
    path: string,
    body: unknown,
  ): Promise<
    | { kind: "ok"; json: Json }
    | {
        kind: "error";
        category: ProviderErrorCategory;
        message: string;
        retryable: boolean;
        retry_after_ms?: number;
      }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout_ms);
    try {
      const response = await this.fetch_fn(`${this.base_url}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.api_key}`,
          "x-api-version": API_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const status = response.status;
      if (status >= 200 && status < 300) {
        try {
          return { kind: "ok", json: await response.json() };
        } catch {
          return err("empty_or_partial", `HTTP ${status} unreadable response`, false);
        }
      }
      if (status === 401 || status === 403) return err("auth_failed", `HTTP ${status} auth_failed`, false);
      if (status === 429) {
        return {
          ...err("rate_limited", `HTTP ${status} rate_limited`, true),
          retry_after_ms: parseRetryAfter(response.headers?.get("retry-after") ?? null),
        };
      }
      if (status >= 500) return err("timeout", `HTTP ${status} timeout`, true);
      return err("bad_request", `HTTP ${status} bad_request`, false);
    } catch {
      return err("timeout", "request failed or timed out (timeout)", true);
    } finally {
      clearTimeout(timer);
    }
  }
}

function err(category: ProviderErrorCategory, message: string, retryable: boolean) {
  return { kind: "error" as const, category, message, retryable };
}

function fail(category: ProviderErrorCategory, message?: string): Failure {
  return { ok: false, error: { category, message: message ?? category } };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

// --- Mapping helpers: never throw on missing or null fields. ---------------

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// Reads "a.b" as nested a -> b.
function pick(obj: Record<string, unknown> | undefined, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) cur = asRecord(cur)?.[part];
  return cur;
}

// The search response is { companies: [...], next_cursor, total_count }.
function extractList(json: Json): unknown[] {
  const list = asRecord(json)?.companies;
  return Array.isArray(list) ? list : [];
}

function mapSearchItem(item: unknown, retrieved_at: string): RawCompany {
  const o = asRecord(item);
  return {
    crustdata_company_id: num(pick(o, "crustdata_company_id")) ?? 0,
    name: str(pick(o, "basic_info.name")),
    primary_domain: str(pick(o, "basic_info.primary_domain")),
    website: str(pick(o, "basic_info.website")),
    professional_network_url: str(pick(o, "basic_info.professional_network_url")),
    employee_count_range: str(pick(o, "basic_info.employee_count_range")),
    industry: str(pick(o, "taxonomy.professional_network_industry")),
    logo: str(pick(o, "basic_info.logo_permalink")),
    source: "search",
    retrieved_at,
    cost_usd: 0,
  };
}

// One element per input URL; takes the highest-confidence match, if any.
function mapEnrichElement(element: unknown, retrieved_at: string): RawCompany | undefined {
  const matches = asRecord(element)?.matches;
  if (!Array.isArray(matches)) return undefined;
  let best: Record<string, unknown> | undefined;
  let best_score = -Infinity;
  for (const m of matches) {
    const rec = asRecord(m);
    if (!rec || !asRecord(rec.company_data)) continue;
    const score = num(rec.confidence_score) ?? 0;
    if (score > best_score) {
      best = rec;
      best_score = score;
    }
  }
  const d = asRecord(best?.company_data);
  if (!d) return undefined;

  const basic = asRecord(d.basic_info);
  const loc = asRecord(d.locations);
  const tax = asRecord(d.taxonomy);

  // Only city / state / country are ever copied from locations.
  const location: { -readonly [K in keyof RawLocation]: RawLocation[K] } = {};
  if (str(loc?.city) !== "") location.city = str(loc?.city);
  if (str(loc?.state) !== "") location.state = str(loc?.state);
  if (str(loc?.country) !== "") location.country = str(loc?.country);

  const founded = num(basic?.year_founded);
  const headcount = num(asRecord(d.headcount)?.total);
  const description = str(basic?.description);
  const legal_type = str(basic?.company_type);
  const specialities = Array.isArray(tax?.professional_network_specialities)
    ? (tax.professional_network_specialities as unknown[]).filter(
        (s): s is string => typeof s === "string" && s !== "",
      )
    : [];

  return {
    crustdata_company_id: num(d.crustdata_company_id) ?? 0,
    name: str(basic?.name),
    primary_domain: str(basic?.primary_domain),
    website: str(basic?.website),
    professional_network_url: str(basic?.professional_network_url),
    employee_count_range: str(basic?.employee_count_range),
    industry: str(tax?.professional_network_industry),
    logo: str(basic?.logo_permalink),
    ...(description !== "" && { description }),
    ...(legal_type !== "" && { legal_type }),
    ...(founded !== undefined && { founded_year: founded }),
    ...(headcount !== undefined && { latest_headcount: headcount }),
    ...(Object.keys(location).length > 0 && { location }),
    ...(specialities.length > 0 && { specialities }),
    source: "enrich",
    retrieved_at,
    cost_usd: CRUSTDATA_PRICE_PER_ENRICHED_COMPANY_USD,
  };
}
