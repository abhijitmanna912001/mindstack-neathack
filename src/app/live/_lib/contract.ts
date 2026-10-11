// Frontend view of the agreed POST /api/live/run contract. The page is not
// connected to the route yet: nothing in this app calls it. These types let
// the preview, its mock adapter and the future real adapter share one shape.

import type { LiveMode, LiveResultsDto } from "./live-results";

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

export const LIVE_MODES: readonly LiveMode[] = ["synthetic", "live"];

// The two notices the server sends with every synthetic-mode response.
export const SYNTHETIC_NOTICES: readonly string[] = [
  "Synthetic demo: fixture companies and a fake model; your search criteria were not used.",
  "One outreach draft deliberately contains an injected unsupported number so you can see the claim check suppress it.",
];

export interface LiveRunSuccess {
  readonly status: "ok";
  readonly mode: LiveMode;
  readonly results: LiveResultsDto;
  readonly usage: { readonly runsRemaining: number };
  readonly notices: readonly string[];
}

export const LIVE_RUN_ERROR_CODES = [
  "invalid_request",
  "invalid_code",
  "no_runs_left",
  "run_in_progress",
  "rate_limited",
  "live_disabled",
  "live_unavailable",
  "budget_exhausted",
  "run_failed",
] as const;
export type LiveRunErrorCode = (typeof LIVE_RUN_ERROR_CODES)[number];

// The error body. field is set for invalid_request, retryAfterSeconds for
// rate_limited.
export interface LiveRunFailure {
  readonly status: LiveRunErrorCode;
  readonly message: string;
  readonly field?: string;
  readonly retryAfterSeconds?: number;
}

export type LiveRunResponse = LiveRunSuccess | LiveRunFailure;

export const LIVE_RUN_SUCCESS_HTTP_STATUS = 200;

export const LIVE_RUN_HTTP_STATUS: Readonly<Record<LiveRunErrorCode, number>> = {
  invalid_request: 400,
  invalid_code: 401,
  no_runs_left: 403,
  run_in_progress: 409,
  rate_limited: 429,
  live_disabled: 503,
  live_unavailable: 503,
  budget_exhausted: 503,
  run_failed: 502,
};

export const isLiveRunSuccess = (response: LiveRunResponse): response is LiveRunSuccess => response.status === "ok";

// How the page submits a run. The preview uses a local mock; the real
// adapter will be added when live integration is explicitly enabled.
export interface LiveRunAdapter {
  submit(request: LiveRunRequest): Promise<LiveRunResponse>;
}
