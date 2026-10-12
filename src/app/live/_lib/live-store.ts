// State for the live-run form, outside React so it can be tested without a
// browser. The page reads it with useSyncExternalStore.
//
// Submission rules:
// - One run at a time. The lock is checked first and set synchronously, so a
//   second click before React re-renders sends nothing.
// - The invitation code leaves the form state as soon as a submission
//   starts. It lives on only in the request being sent; it is never put in
//   the URL, stored, logged or rendered.
// - While a run is in progress, elapsed seconds tick so the page can show
//   them. A timed-out request is never retried automatically.

import type { LiveCompanySize, LiveRunAdapter } from "./contract";
import { createSubmissionController, type LiveViewState, serverFieldErrors, viewStateFor } from "./submission";
import { EMPTY_LIVE_FORM, type LiveFormErrors, type LiveFormValues, toggleSize, validateLiveForm } from "./validation";

export interface LiveRunState {
  readonly values: LiveFormValues;
  readonly errors: LiveFormErrors;
  readonly view: LiveViewState;
  readonly elapsedSeconds: number;
}

export interface LiveRunStore {
  getState(): LiveRunState;
  subscribe(listener: () => void): () => void;
  setCode(code: string): void;
  setIndustry(industry: string): void;
  setSize(size: LiveCompanySize, checked: boolean): void;
  // Validates and sends the form. Resolves when the run has an outcome.
  submit(): Promise<void>;
  // Returns from an outcome to the form, keeping what the user typed.
  back(): void;
  // Stops waiting for an in-flight request and its timer, without showing an
  // outcome. Safe to call more than once; the store stays usable.
  cancel(): void;
}

export const INITIAL_LIVE_RUN_STATE: LiveRunState = {
  values: EMPTY_LIVE_FORM,
  errors: {},
  view: { kind: "idle" },
  elapsedSeconds: 0,
};

export function createLiveRunStore(adapter: LiveRunAdapter): LiveRunStore {
  const controller = createSubmissionController(adapter);
  const listeners = new Set<() => void>();
  let state = INITIAL_LIVE_RUN_STATE;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let abort: AbortController | undefined;

  function update(patch: Partial<LiveRunState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function stopTicker() {
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setCode: (code) => update({ values: { ...state.values, code } }),
    setIndustry: (industry) => update({ values: { ...state.values, industry } }),
    setSize: (size, checked) => update({ values: { ...state.values, sizes: toggleSize(state.values.sizes, size, checked) } }),

    async submit() {
      // The lock comes first: while a run is in progress nothing else
      // happens, not even validation of the (now cleared) code.
      if (controller.inFlight) return;
      const checked = validateLiveForm(state.values);
      if (!checked.ok) {
        update({ errors: checked.errors, view: { kind: "idle" } });
        return;
      }

      const started = Date.now();
      abort = new AbortController();
      const signal = abort.signal;
      const pending = controller.submit(checked.request, { signal });
      update({
        values: { ...state.values, code: "" },
        errors: {},
        view: { kind: "loading" },
        elapsedSeconds: 0,
      });
      stopTicker();
      ticker = setInterval(() => update({ elapsedSeconds: Math.floor((Date.now() - started) / 1000) }), 1000);

      const outcome = await pending;
      // Cancelled while waiting: cancel() already cleaned up; show nothing.
      if (signal.aborted) return;
      stopTicker();
      abort = undefined;
      switch (outcome.kind) {
        case "done": {
          const view = viewStateFor(outcome.response);
          update({ view, errors: serverFieldErrors(view) });
          return;
        }
        case "timeout":
          update({ view: { kind: "timeout" } });
          return;
        case "aborted":
        case "ignored":
          return;
      }
    },

    back: () => update({ view: { kind: "idle" } }),

    cancel() {
      stopTicker();
      abort?.abort();
      abort = undefined;
      if (state.view.kind === "loading") update({ view: { kind: "idle" } });
    },
  };
}
