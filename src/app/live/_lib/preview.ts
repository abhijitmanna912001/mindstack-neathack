// Frontend-preview support: the simulated server responses a viewer can pick,
// and a local mock adapter that returns them. It never touches the network:
// no fetch, no /api/live call, no backend. Success responses are synthetic
// fixtures and are labelled as such; there is no live scenario, because the
// preview never presents fixture data as a live run.

import type { LiveRunAdapter, LiveRunErrorCode, LiveRunFailure, LiveRunResponse, LiveRunSuccess } from "./contract";
import { ERROR_PRESENTATION } from "./messages";

export interface PreviewFixtures {
  readonly success: LiveRunSuccess;
  readonly partial: LiveRunSuccess;
}

export type PreviewScenario = "success" | "partial" | LiveRunErrorCode;

export const PREVIEW_SCENARIOS: readonly { readonly id: PreviewScenario; readonly label: string }[] = [
  { id: "success", label: "Synthetic demo run (fixtures)" },
  { id: "partial", label: "Synthetic demo run, partial results (fixtures)" },
  { id: "invalid_code", label: "Invalid code" },
  { id: "no_runs_left", label: "No runs left" },
  { id: "run_in_progress", label: "Run already in progress" },
  { id: "rate_limited", label: "Rate limited" },
  { id: "live_disabled", label: "Kill switch enabled" },
  { id: "live_unavailable", label: "Live mode unavailable" },
  { id: "budget_exhausted", label: "Budget exhausted" },
  { id: "run_failed", label: "Failed run" },
  { id: "invalid_request", label: "Invalid request (industry not matched)" },
];

export const PREVIEW_DELAY_MS = 700;

// Example values for the error bodies' optional fields.
export const PREVIEW_INVALID_FIELD = "industry";
export const PREVIEW_RETRY_AFTER_SECONDS = 30;

export function previewError(code: LiveRunErrorCode): LiveRunFailure {
  const failure: LiveRunFailure = { status: code, message: ERROR_PRESENTATION[code].message };
  if (code === "invalid_request") return { ...failure, field: PREVIEW_INVALID_FIELD };
  if (code === "rate_limited") return { ...failure, retryAfterSeconds: PREVIEW_RETRY_AFTER_SECONDS };
  return failure;
}

export function previewResponse(scenario: PreviewScenario, fixtures: PreviewFixtures): LiveRunResponse {
  if (scenario === "success") return fixtures.success;
  if (scenario === "partial") return fixtures.partial;
  return previewError(scenario);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The preview's adapter: waits briefly (so the loading state is visible),
// then returns the chosen scenario's synthetic response. The request,
// including the invitation code and the search details, is ignored and never
// stored or sent: like a synthetic-mode code, it does not affect the result.
export function createPreviewAdapter(
  fixtures: PreviewFixtures,
  scenario: () => PreviewScenario,
  delayMs: number = PREVIEW_DELAY_MS,
): LiveRunAdapter {
  return {
    async submit() {
      const chosen = scenario();
      if (delayMs > 0) await wait(delayMs);
      return previewResponse(chosen, fixtures);
    },
  };
}
