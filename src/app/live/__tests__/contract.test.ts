// The agreed response contract: exact success and error shapes, the HTTP
// mapping, field and retryAfterSeconds, and agreement with the server's
// synthetic notices and results-mapper signature. Pure: no network.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SYNTHETIC_NOTICES as SERVER_SYNTHETIC_NOTICES, type ToResults } from "../../../server/live/run-live";
import {
  LIVE_RUN_ERROR_CODES,
  LIVE_RUN_HTTP_STATUS,
  LIVE_RUN_SUCCESS_HTTP_STATUS,
  type LiveRunErrorCode,
  SYNTHETIC_NOTICES,
} from "../_lib/contract";
import { buildPreviewFixtures } from "../_lib/fixtures";
import { toLiveResultsDto } from "../_lib/live-results";
import { ERROR_PRESENTATION } from "../_lib/messages";
import { type PreviewFixtures, previewError } from "../_lib/preview";
import { readLiveRunResponse, UNREADABLE_RESPONSE_MESSAGE } from "../_lib/response";
import { viewStateFor } from "../_lib/submission";

let fixtures: PreviewFixtures;
beforeAll(async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
  fixtures = await buildPreviewFixtures();
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const UNREADABLE = { status: "run_failed", message: UNREADABLE_RESPONSE_MESSAGE };

describe("agreement with the server", () => {
  it("uses the server's two synthetic notices word for word", () => {
    expect(SYNTHETIC_NOTICES).toEqual(SERVER_SYNTHETIC_NOTICES);
  });

  it("can be injected as the server's results mapper", () => {
    const mapper: ToResults = toLiveResultsDto;
    expect(mapper).toBe(toLiveResultsDto);
  });
});

describe("success shape", () => {
  it("is { status, mode, results, usage: { runsRemaining }, notices }", () => {
    for (const response of [fixtures.success, fixtures.partial]) {
      expect(Object.keys(response).sort()).toEqual(["mode", "notices", "results", "status", "usage"]);
      expect(response.status).toBe("ok");
      expect(Object.keys(response.usage)).toEqual(["runsRemaining"]);
      expect(response.mode).toBe(response.results.run.mode);
    }
  });
});

describe("error shapes", () => {
  it.each(LIVE_RUN_ERROR_CODES)("%s carries status and message, plus only its own optional field", (code) => {
    const body = previewError(code);
    const keys = Object.keys(body).sort();
    if (code === "invalid_request") expect(keys).toEqual(["field", "message", "status"]);
    else if (code === "rate_limited") expect(keys).toEqual(["message", "retryAfterSeconds", "status"]);
    else expect(keys).toEqual(["message", "status"]);
    expect(body.status).toBe(code);
    expect(typeof body.message).toBe("string");
  });

  it("uses live_unavailable, not service_unavailable", () => {
    expect(LIVE_RUN_ERROR_CODES).toContain("live_unavailable");
    expect(LIVE_RUN_ERROR_CODES as readonly string[]).not.toContain("service_unavailable");
    expect(readLiveRunResponse(503, { status: "live_unavailable", message: "m" })).toEqual({
      status: "live_unavailable",
      message: "m",
    });
    expect(ERROR_PRESENTATION.live_unavailable.title).toBe("Live mode unavailable");
  });

  it("shows live_disabled, which the server returns for a live code while live mode is not configured", () => {
    const read = readLiveRunResponse(503, { status: "live_disabled", message: "Live runs are switched off right now." });
    expect(viewStateFor(read)).toEqual({ kind: "error", code: "live_disabled" });
    expect(ERROR_PRESENTATION.live_disabled.title).toBe("Live runs are switched off");
  });
});

describe("HTTP mapping", () => {
  it("matches the agreed statuses", () => {
    expect(LIVE_RUN_SUCCESS_HTTP_STATUS).toBe(200);
    expect(LIVE_RUN_HTTP_STATUS).toEqual({
      invalid_request: 400,
      invalid_code: 401,
      no_runs_left: 403,
      run_in_progress: 409,
      rate_limited: 429,
      live_disabled: 503,
      live_unavailable: 503,
      budget_exhausted: 503,
      run_failed: 502,
    });
  });

  it("has a presentation for every error code", () => {
    expect(Object.keys(ERROR_PRESENTATION).sort()).toEqual([...LIVE_RUN_ERROR_CODES].sort());
  });
});

describe("reading a response", () => {
  it("accepts a contract success body", () => {
    const body = JSON.parse(JSON.stringify(fixtures.success));
    expect(readLiveRunResponse(200, body)).toEqual(body);
  });

  it("reads usage as runsRemaining only", () => {
    const body = JSON.parse(JSON.stringify(fixtures.success));
    expect(body.usage).toEqual({ runsRemaining: 2 });
    // Fields from the earlier server shape are not carried over.
    const read = readLiveRunResponse(200, {
      ...body,
      usage: { runsRemaining: 1, searched: 10, enriched: 5, providerCostUsd: 3.69 },
    });
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.usage).toEqual({ runsRemaining: 1 });
  });

  it.each(LIVE_RUN_ERROR_CODES)("maps the %s error at its HTTP status", (code: LiveRunErrorCode) => {
    const read = readLiveRunResponse(LIVE_RUN_HTTP_STATUS[code], { status: code, message: "Fixed server text." });
    expect(read).toEqual({ status: code, message: "Fixed server text." });
    expect(viewStateFor(read)).toEqual({ kind: "error", code });
  });

  it("preserves field for invalid_request and retryAfterSeconds for rate_limited", () => {
    const invalid = readLiveRunResponse(400, { status: "invalid_request", field: "industry", message: "m" });
    expect(invalid).toEqual({ status: "invalid_request", field: "industry", message: "m" });
    expect(viewStateFor(invalid)).toEqual({ kind: "error", code: "invalid_request", field: "industry" });

    const limited = readLiveRunResponse(429, { status: "rate_limited", retryAfterSeconds: 12.2, message: "m" });
    expect(limited).toEqual({ status: "rate_limited", retryAfterSeconds: 13, message: "m" });
    expect(viewStateFor(limited)).toEqual({ kind: "error", code: "rate_limited", retryAfterSeconds: 13 });
  });

  it("drops optional fields that do not belong to the error, or are malformed", () => {
    expect(readLiveRunResponse(401, { status: "invalid_code", field: "code", retryAfterSeconds: 5, message: "m" })).toEqual({
      status: "invalid_code",
      message: "m",
    });
    expect(readLiveRunResponse(400, { status: "invalid_request", field: "<b>x</b>", message: "m" })).toEqual({
      status: "invalid_request",
      message: "m",
    });
    expect(readLiveRunResponse(429, { status: "rate_limited", retryAfterSeconds: -1, message: "m" })).toEqual({
      status: "rate_limited",
      message: "m",
    });
  });

  it("treats anything off-contract as a failed run", () => {
    const ok = JSON.parse(JSON.stringify(fixtures.success));
    for (const [status, body] of [
      [401, { status: "run_failed", message: "m" }], // status disagrees with HTTP
      [503, { status: "service_unavailable", message: "m" }], // unknown code
      [400, { status: "invalid_request" }], // no message
      [500, ok], // success body at a non-200 status
      [200, { ...ok, mode: "live" }], // mode disagrees with the results
      [200, { ...ok, mode: "other" }],
      [200, { ...ok, usage: { runsRemaining: -1 } }],
      [200, { ...ok, notices: [1] }],
      [200, { ...ok, results: null }],
      [200, null],
      [200, "ok"],
    ] as const) {
      expect(readLiveRunResponse(status, body)).toEqual(UNREADABLE);
    }
  });
});
