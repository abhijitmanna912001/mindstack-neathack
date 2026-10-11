// What the page tells the user for each fixed error state, and how to
// recover. Wording never blames the user's data or promises a result.

import type { LiveRunErrorCode } from "./contract";

export interface ErrorPresentation {
  readonly title: string;
  readonly message: string;
  readonly recovery: string;
  // "edit": fix the form and resubmit. "retry": the same request may work
  // later. "none": nothing the user can do now.
  readonly action: "edit" | "retry" | "none";
}

export const ERROR_PRESENTATION: Readonly<Record<LiveRunErrorCode, ErrorPresentation>> = {
  invalid_request: {
    title: "The request could not be accepted",
    message: "Some of the details were not in the expected format.",
    recovery: "Check the form and submit again.",
    action: "edit",
  },
  invalid_code: {
    title: "Invitation code not recognised",
    message: "That invitation code is not valid for this beta.",
    recovery: "Check the code exactly as it appears in your invitation and try again.",
    action: "edit",
  },
  no_runs_left: {
    title: "No runs left on this invitation",
    message: "This invitation code has used all of its runs.",
    recovery: "Contact the builders if you need more runs.",
    action: "none",
  },
  run_in_progress: {
    title: "A run is already in progress",
    message: "This invitation already has a run in progress. Only one run at a time is allowed.",
    recovery: "Wait for it to finish, then try again.",
    action: "retry",
  },
  rate_limited: {
    title: "Too many requests",
    message: "Requests are being limited for a moment.",
    recovery: "Wait a little and try again.",
    action: "retry",
  },
  live_disabled: {
    title: "Live runs are switched off",
    message: "The builders have temporarily disabled live runs.",
    recovery: "Please try again later.",
    action: "none",
  },
  service_unavailable: {
    title: "Service unavailable",
    message: "A service the run depends on is not available right now.",
    recovery: "Try again in a few minutes.",
    action: "retry",
  },
  budget_exhausted: {
    title: "Beta budget used up",
    message: "The sponsored budget for live runs has been used up.",
    recovery: "Please check back later.",
    action: "none",
  },
  run_failed: {
    title: "The run failed",
    message: "The run did not complete.",
    recovery: "Try again. If it keeps failing, contact the builders.",
    action: "retry",
  },
};
