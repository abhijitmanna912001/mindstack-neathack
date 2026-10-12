// The real live-run adapter. This is the only production file that calls
// fetch, and its one call targets the same-origin route /api/live/run.
//
// The body is exactly the agreed request: the invitation code and the ICP.
// The response goes through readLiveRunResponse; a body that is not JSON, or
// not the agreed contract, becomes the fixed run_failed response. Raw bodies,
// error text and stack traces are never returned. Nothing is logged or stored.

import type { LiveRunAdapter, LiveRunRequest, LiveRunResponse } from "./contract";
import { readLiveRunResponse } from "./response";
import { LiveRunAbortedError, LiveRunTimeoutError } from "./submission";

export const LIVE_RUN_PATH = "/api/live/run";

// A run can take about a minute; the page stops waiting after two. Stopping
// does not cancel the run on the server.
export const LIVE_RUN_TIMEOUT_MS = 120_000;

export function liveRunBody(request: LiveRunRequest): string {
  return JSON.stringify({
    code: request.code,
    icp: {
      industry: request.icp.industry,
      country: request.icp.country,
      sizes: [...request.icp.sizes],
    },
  });
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createLiveApiAdapter(timeoutMs: number = LIVE_RUN_TIMEOUT_MS): LiveRunAdapter {
  return {
    async submit(request, options = {}): Promise<LiveRunResponse> {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const external = options.signal;
      const onAbort = () => controller.abort();
      if (external?.aborted) controller.abort();
      external?.addEventListener("abort", onAbort);

      try {
        const response = await fetch(LIVE_RUN_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: liveRunBody(request),
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        // Reading the body is covered by the same timeout and signal.
        return readLiveRunResponse(response.status, await readBody(response));
      } catch {
        if (timedOut) throw new LiveRunTimeoutError();
        if (external?.aborted) throw new LiveRunAbortedError();
        // A network failure: the submission controller turns this into the
        // fixed run_failed response. The error itself is not passed on.
        throw new Error("live run request failed");
      } finally {
        clearTimeout(timer);
        external?.removeEventListener("abort", onAbort);
      }
    },
  };
}
