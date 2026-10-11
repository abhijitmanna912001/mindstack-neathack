// Frontend-preview support: the simulated server responses a viewer can pick,
// and a local mock adapter that returns them. It never touches the network:
// no fetch, no /api/live call, no backend. Every response is built from
// synthetic fixtures and is labelled as such.

import type { LiveRunAdapter, LiveRunErrorCode, LiveRunResponse, LiveRunSuccess } from "./contract";

export interface PreviewFixtures {
  readonly success: LiveRunSuccess;
  readonly partial: LiveRunSuccess;
}

export type PreviewScenario = "success" | "partial" | LiveRunErrorCode;

export const PREVIEW_SCENARIOS: readonly { readonly id: PreviewScenario; readonly label: string }[] = [
  { id: "success", label: "Success (synthetic fixtures)" },
  { id: "partial", label: "Partial results (synthetic fixtures)" },
  { id: "invalid_code", label: "Invalid code" },
  { id: "no_runs_left", label: "No runs left" },
  { id: "run_in_progress", label: "Run already in progress" },
  { id: "rate_limited", label: "Rate limited" },
  { id: "live_disabled", label: "Kill switch enabled" },
  { id: "service_unavailable", label: "Service unavailable" },
  { id: "budget_exhausted", label: "Budget exhausted" },
  { id: "run_failed", label: "Failed run" },
  { id: "invalid_request", label: "Invalid request" },
];

export const PREVIEW_DELAY_MS = 700;

export function previewResponse(scenario: PreviewScenario, fixtures: PreviewFixtures): LiveRunResponse {
  if (scenario === "success") return fixtures.success;
  if (scenario === "partial") return fixtures.partial;
  return { status: "error", code: scenario };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The preview's adapter: waits briefly (so the loading state is visible),
// then returns the chosen scenario's synthetic response. The request,
// including the invitation code, is ignored and never stored or sent.
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
