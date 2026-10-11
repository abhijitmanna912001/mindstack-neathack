// Frontend view of the planned POST /api/live/run contract. The backend is
// not ready: nothing in this app calls that endpoint yet. These types let the
// preview, its mock adapter and the future real adapter share one shape.
//
// The success shape follows the agreed contract. The error codes below are
// the frontend's names for the fixed error states the server will return;
// the real adapter will map the server's actual error format onto them.

import type { ResultsDto } from "../../results/_lib/presentation";

export const LIVE_COUNTRY = "India";
export const LIVE_COMPANY_SIZES = ["11-50", "51-200"] as const;
export type LiveCompanySize = (typeof LIVE_COMPANY_SIZES)[number];

export interface LiveRunRequest {
  readonly code: string;
  readonly icp: {
    readonly industry: string;
    readonly country: typeof LIVE_COUNTRY;
    readonly sizes: readonly LiveCompanySize[];
  };
}

export interface LiveRunUsage {
  readonly runsRemaining: number;
  readonly searched: number;
  readonly enriched: number;
  readonly providerCostUsd: number;
}

export interface LiveRunSuccess {
  readonly status: "ok";
  readonly results: ResultsDto;
  readonly usage: LiveRunUsage;
  readonly notices: readonly string[];
}

export const LIVE_RUN_ERROR_CODES = [
  "invalid_request",
  "invalid_code",
  "no_runs_left",
  "run_in_progress",
  "rate_limited",
  "live_disabled",
  "service_unavailable",
  "budget_exhausted",
  "run_failed",
] as const;
export type LiveRunErrorCode = (typeof LIVE_RUN_ERROR_CODES)[number];

export interface LiveRunFailure {
  readonly status: "error";
  readonly code: LiveRunErrorCode;
}

export type LiveRunResponse = LiveRunSuccess | LiveRunFailure;

// How the page submits a run. The preview uses a local mock; the real
// adapter will be added when live integration is explicitly enabled.
export interface LiveRunAdapter {
  submit(request: LiveRunRequest): Promise<LiveRunResponse>;
}
