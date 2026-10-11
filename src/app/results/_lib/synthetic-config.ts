// Fixed inputs for the results page's synthetic run. They mirror the
// evaluation set-up used by scripts/run-pipeline.ts (10 searched companies,
// 5 enrichments, an ICP with no filters), which the web app cannot import.

import type { IcpInput } from "../../../core/agent/types";
import { DEFAULT_RUN_CONFIG, type RunConfig } from "../../../core/types";

export const SYNTHETIC_RUN_CONFIG: RunConfig = {
  ...DEFAULT_RUN_CONFIG,
  max_search_results: 10,
  max_enrichments: 5,
};

// No filters: every synthetic fixture company is searched.
export const SYNTHETIC_ICP: IcpInput = {
  industry: "",
  employee_count_ranges: [],
  locations: [],
  keywords: [],
  excluded_domains: [],
};

// The data comes from FixtureProvider, so facts are labelled "fixture".
export const SYNTHETIC_FACT_PROVIDER = "fixture" as const;

// A fixed label instead of a random trace id: this run is never traced.
export const SYNTHETIC_TRACE_LABEL = "synthetic-results-demo";

// Simulated per-record prices for FixtureProvider, matching the runner's
// SIMULATED_COST_PER_RECORD. Nothing is charged: no provider is called.
export const SIMULATED_COST_PER_RECORD = { search: 0.069, enrich: 0.6 } as const;
