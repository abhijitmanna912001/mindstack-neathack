// Submission state for the live page: one run at a time, and a plain view
// state for rendering. Pure, so it is tested without a browser.

import type { LiveRunAdapter, LiveRunErrorCode, LiveRunRequest, LiveRunResponse, LiveRunSuccess } from "./contract";
import type { LiveResultsDto } from "./live-results";
import { SERVER_FIELD_ERROR } from "./messages";
import type { LiveFormErrors } from "./validation";

export type LiveViewState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "success"; readonly response: LiveRunSuccess; readonly partial: boolean }
  | {
      readonly kind: "error";
      readonly code: LiveRunErrorCode;
      // invalid_request: the field the server rejected.
      readonly field?: string;
      // rate_limited: how long to wait.
      readonly retryAfterSeconds?: number;
    };

// Issue codes that mean the run stopped early or skipped work, so the
// results are incomplete. A stopped run is also partial. A completed run
// whose search found nothing (completed_empty, search_no_match) is complete,
// not partial; so is a run whose only issue is an incomplete model cost.
export const PARTIAL_ISSUE_CODES: readonly string[] = [
  "llm_call_cap_reached",
  "llm_stopped",
  "enrich_partial",
  "enrich_failed",
  "enrich_no_results",
  "enrich_budget_exhausted",
  "search_budget_exhausted",
];

export function isPartialResults(results: LiveResultsDto): boolean {
  return results.run.status === "stopped" || results.issues.some((i) => PARTIAL_ISSUE_CODES.includes(i.code));
}

export function viewStateFor(response: LiveRunResponse): LiveViewState {
  if (response.status !== "ok") {
    return {
      kind: "error",
      code: response.status,
      ...(response.status === "invalid_request" && response.field !== undefined ? { field: response.field } : {}),
      ...(response.status === "rate_limited" && response.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: response.retryAfterSeconds }
        : {}),
    };
  }
  return { kind: "success", response, partial: isPartialResults(response.results) };
}

// An invalid_request error names the field the server rejected; the form
// marks it so the user can see what to change.
export function serverFieldErrors(view: LiveViewState): LiveFormErrors {
  if (view.kind !== "error" || view.field === undefined) return {};
  const field = view.field;
  return field === "code" || field === "industry" || field === "sizes" ? { [field]: SERVER_FIELD_ERROR } : {};
}

export type SubmitOutcome =
  | { readonly kind: "done"; readonly response: LiveRunResponse }
  // A run was already in progress; nothing was sent.
  | { readonly kind: "ignored" };

export interface SubmissionController {
  readonly inFlight: boolean;
  submit(request: LiveRunRequest): Promise<SubmitOutcome>;
}

export const ADAPTER_FAILURE_MESSAGE = "The run could not be completed.";

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
        return { kind: "done", response: { status: "run_failed", message: ADAPTER_FAILURE_MESSAGE } };
      } finally {
        inFlight = false;
      }
    },
  };
}
