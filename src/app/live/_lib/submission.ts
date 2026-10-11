// Submission state for the live page: one run at a time, and a plain view
// state for rendering. Pure, so it is tested without a browser.

import type { ResultsDto } from "../../results/_lib/presentation";
import type { LiveRunAdapter, LiveRunErrorCode, LiveRunRequest, LiveRunResponse, LiveRunSuccess } from "./contract";

export type LiveViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "success"; readonly response: LiveRunSuccess; readonly partial: boolean }
  | { readonly kind: "error"; readonly code: LiveRunErrorCode };

// Issue codes that mean the run stopped early or skipped work, so the
// results are incomplete. A run whose status is not "completed" is also
// partial.
export const PARTIAL_ISSUE_CODES: readonly string[] = [
  "llm_call_cap_reached",
  "llm_stopped",
  "enrich_partial",
  "enrich_failed",
  "enrich_no_results",
  "enrich_budget_exhausted",
  "search_budget_exhausted",
];

export function isPartialResults(results: ResultsDto): boolean {
  return results.run.status !== "completed" || results.issues.some((i) => PARTIAL_ISSUE_CODES.includes(i.code));
}

export function viewStateFor(response: LiveRunResponse): LiveViewState {
  if (response.status === "error") return { kind: "error", code: response.code };
  return { kind: "success", response, partial: isPartialResults(response.results) };
}

export type SubmitOutcome =
  | { readonly kind: "done"; readonly response: LiveRunResponse }
  // A run was already in progress; nothing was sent.
  | { readonly kind: "ignored" };

export interface SubmissionController {
  readonly inFlight: boolean;
  submit(request: LiveRunRequest): Promise<SubmitOutcome>;
}

// Wraps an adapter so a second submission while one is running is ignored
// instead of sent. A thrown adapter error becomes a failed run.
export function createSubmissionController(adapter: LiveRunAdapter): SubmissionController {
  let inFlight = false;
  return {
    get inFlight() {
      return inFlight;
    },
    async submit(request) {
      if (inFlight) return { kind: "ignored" };
      inFlight = true;
      try {
        return { kind: "done", response: await adapter.submit(request) };
      } catch {
        return { kind: "done", response: { status: "error", code: "run_failed" } };
      } finally {
        inFlight = false;
      }
    },
  };
}
