// Submission flow with the local mock adapter: loading, duplicate-submit
// prevention, every simulated response, and no network. Global fetch is
// stubbed to throw so any network attempt fails the test.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LiveRunAdapter, LiveRunRequest, LiveRunResponse } from "../_lib/contract";
import { LIVE_RUN_ERROR_CODES } from "../_lib/contract";
import { buildPreviewFixtures } from "../_lib/fixtures";
import { createPreviewAdapter, PREVIEW_SCENARIOS, previewResponse, type PreviewFixtures } from "../_lib/preview";
import { createSubmissionController, isPartialResults, viewStateFor } from "../_lib/submission";

let fetchCalls = 0;
beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    fetchCalls += 1;
    throw new Error("Network access is not allowed in these tests.");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const REQUEST: LiveRunRequest = {
  code: "ABCDE-FGHIJ-KLMNO-PQRST",
  icp: { industry: "Staffing and Recruiting", country: "India", sizes: ["11-50", "51-200"] },
};

let fixtures: PreviewFixtures;
beforeAll(async () => {
  fixtures = await buildPreviewFixtures();
});

// An adapter whose response is released by the test.
function deferredAdapter() {
  let release!: (response: LiveRunResponse) => void;
  const calls: LiveRunRequest[] = [];
  const adapter: LiveRunAdapter = {
    submit(request) {
      calls.push(request);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  return { adapter, calls, release: (r: LiveRunResponse) => release(r) };
}

describe("submission controller", () => {
  it("is in flight while a run is pending, and not before or after", async () => {
    const { adapter, release } = deferredAdapter();
    const controller = createSubmissionController(adapter);
    expect(controller.inFlight).toBe(false);
    const pending = controller.submit(REQUEST);
    expect(controller.inFlight).toBe(true);
    release(fixtures.success);
    await pending;
    expect(controller.inFlight).toBe(false);
  });

  it("ignores a second submission while one is running", async () => {
    const { adapter, calls, release } = deferredAdapter();
    const controller = createSubmissionController(adapter);
    const first = controller.submit(REQUEST);
    const second = await controller.submit(REQUEST);
    const third = await controller.submit(REQUEST);
    expect(second).toEqual({ kind: "ignored" });
    expect(third).toEqual({ kind: "ignored" });
    expect(calls).toHaveLength(1);
    release(fixtures.success);
    expect(await first).toEqual({ kind: "done", response: fixtures.success });
  });

  it("accepts a new submission once the previous one finishes", async () => {
    const { adapter, calls, release } = deferredAdapter();
    const controller = createSubmissionController(adapter);
    const first = controller.submit(REQUEST);
    release({ status: "error", code: "rate_limited" });
    await first;
    const again = controller.submit(REQUEST);
    expect(calls).toHaveLength(2);
    release(fixtures.success);
    expect((await again).kind).toBe("done");
  });

  it("turns a thrown adapter error into a failed run", async () => {
    const controller = createSubmissionController({
      submit: async () => {
        throw new Error("boom");
      },
    });
    expect(await controller.submit(REQUEST)).toEqual({ kind: "done", response: { status: "error", code: "run_failed" } });
    expect(controller.inFlight).toBe(false);
  });
});

describe("preview adapter", () => {
  it("offers every error state, success and partial results", () => {
    const ids = PREVIEW_SCENARIOS.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["success", "partial", ...LIVE_RUN_ERROR_CODES]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(LIVE_RUN_ERROR_CODES)("returns the fixed %s error", async (code) => {
    const adapter = createPreviewAdapter(fixtures, () => code, 0);
    expect(await adapter.submit(REQUEST)).toEqual({ status: "error", code });
  });

  it("returns the synthetic success and partial responses", async () => {
    expect(await createPreviewAdapter(fixtures, () => "success", 0).submit(REQUEST)).toBe(fixtures.success);
    expect(await createPreviewAdapter(fixtures, () => "partial", 0).submit(REQUEST)).toBe(fixtures.partial);
  });

  it("keeps the run in flight during its simulated delay (the loading state)", async () => {
    vi.useFakeTimers();
    try {
      const controller = createSubmissionController(createPreviewAdapter(fixtures, () => "success", 700));
      const pending = controller.submit(REQUEST);
      await vi.advanceTimersByTimeAsync(500);
      expect(controller.inFlight).toBe(true);
      expect(await controller.submit(REQUEST)).toEqual({ kind: "ignored" });
      await vi.advanceTimersByTimeAsync(300);
      expect((await pending).kind).toBe("done");
      expect(controller.inFlight).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never makes a network request, and never echoes the code back", async () => {
    const before = fetchCalls;
    for (const { id } of PREVIEW_SCENARIOS) {
      const response = await createPreviewAdapter(fixtures, () => id, 0).submit(REQUEST);
      expect(JSON.stringify(response)).not.toContain(REQUEST.code);
    }
    expect(fetchCalls).toBe(before);
  });
});

describe("view state", () => {
  it("maps each response to the state the page renders", () => {
    expect(viewStateFor(fixtures.success)).toEqual({ kind: "success", response: fixtures.success, partial: false });
    expect(viewStateFor(fixtures.partial)).toEqual({ kind: "success", response: fixtures.partial, partial: true });
    for (const code of LIVE_RUN_ERROR_CODES) {
      expect(viewStateFor(previewResponse(code, fixtures))).toEqual({ kind: "error", code });
    }
  });

  it("treats a stopped run or a cut-short step as partial", () => {
    const results = fixtures.success.results;
    expect(isPartialResults(results)).toBe(false);
    expect(isPartialResults({ ...results, run: { ...results.run, status: "stopped" } })).toBe(true);
    expect(isPartialResults({ ...results, issues: [{ code: "enrich_partial", message: "x" }] })).toBe(true);
    expect(isPartialResults({ ...results, issues: [{ code: "extra_locations_ignored", message: "x" }] })).toBe(false);
  });
});
