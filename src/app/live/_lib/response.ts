// Pure interpretation of an HTTP status and JSON body from the agreed live-run
// contract. No network: the real adapter (not built yet) will pass what it
// receives through here. Anything that does not match the contract, including
// a body whose status disagrees with the HTTP status, becomes run_failed.

import type { LiveMode, LiveResultsDto } from "./live-results";
import {
  LIVE_MODES,
  LIVE_RUN_ERROR_CODES,
  LIVE_RUN_HTTP_STATUS,
  LIVE_RUN_SUCCESS_HTTP_STATUS,
  type LiveRunErrorCode,
  type LiveRunFailure,
  type LiveRunResponse,
} from "./contract";

export const UNREADABLE_RESPONSE_MESSAGE = "The response could not be read.";
const MAX_MESSAGE_LENGTH = 300;
const FIELD = /^[a-z][a-z0-9_]{0,31}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isErrorCode = (v: unknown): v is LiveRunErrorCode =>
  typeof v === "string" && (LIVE_RUN_ERROR_CODES as readonly string[]).includes(v);

const unreadable = (): LiveRunFailure => ({ status: "run_failed", message: UNREADABLE_RESPONSE_MESSAGE });

function readSuccess(body: Record<string, unknown>): LiveRunResponse {
  const { mode, results, usage, notices } = body;
  if (typeof mode !== "string" || !(LIVE_MODES as readonly string[]).includes(mode)) return unreadable();
  if (!isRecord(usage) || !Number.isInteger(usage.runsRemaining) || (usage.runsRemaining as number) < 0) {
    return unreadable();
  }
  if (!Array.isArray(notices) || !notices.every((n) => typeof n === "string")) return unreadable();
  if (!isRecord(results) || !isRecord(results.run) || results.run.mode !== mode) return unreadable();
  return {
    status: "ok",
    mode: mode as LiveMode,
    // The server builds results with toLiveResultsDto; only its mode is checked here.
    results: results as unknown as LiveResultsDto,
    usage: { runsRemaining: usage.runsRemaining as number },
    notices: [...(notices as string[])],
  };
}

function readFailure(httpStatus: number, body: Record<string, unknown>): LiveRunResponse {
  const { status, message, field, retryAfterSeconds } = body;
  if (!isErrorCode(status) || LIVE_RUN_HTTP_STATUS[status] !== httpStatus || typeof message !== "string") {
    return unreadable();
  }
  const failure: LiveRunFailure = { status, message: message.slice(0, MAX_MESSAGE_LENGTH) };
  if (status === "invalid_request" && typeof field === "string" && FIELD.test(field)) {
    return { ...failure, field };
  }
  if (
    status === "rate_limited" &&
    typeof retryAfterSeconds === "number" &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds > 0
  ) {
    return { ...failure, retryAfterSeconds: Math.ceil(retryAfterSeconds) };
  }
  return failure;
}

export function readLiveRunResponse(httpStatus: number, body: unknown): LiveRunResponse {
  if (!isRecord(body)) return unreadable();
  if (body.status === "ok") {
    return httpStatus === LIVE_RUN_SUCCESS_HTTP_STATUS ? readSuccess(body) : unreadable();
  }
  return readFailure(httpStatus, body);
}
