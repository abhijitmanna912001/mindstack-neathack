// HTTP layer for live mode. Pure: no process.env and no src/app imports; the
// runtime (deps and store) is injected. Never logs, and no response ever
// carries thrown-error text.

import { hashIp } from "./codes";
import { type LiveDeps, type LiveOutcome, liveUnavailable, runLive } from "./run-live";
import type { LiveStore } from "./store";

export interface LiveRuntime {
  // null means the database or the secret is not configured.
  getDeps(): Promise<LiveDeps | null>;
  getStore(): Promise<LiveStore | null>;
}

const MAX_BODY_BYTES = 4096;
const MAX_IP_LENGTH = 64;
const STATUS_WINDOW_SECONDS = 60;
const STATUS_LIMIT = 60;

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
} as const;

const INVALID_BODY = {
  status: "invalid_request",
  field: "code",
  message: "Enter your invite code (up to 64 characters).",
} as const;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: HEADERS });
}

function send(outcome: LiveOutcome): Response {
  return json(outcome.body, outcome.httpStatus);
}

// The client ip is read from x-real-ip, else the first x-forwarded-for entry.
// These headers are trustworthy only behind a platform that sets them itself
// (such as Vercel); I have not verified Vercel's overwrite behaviour. Anywhere
// else a caller can spoof them and dodge the per-ip limits.
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = real || forwarded || "unknown";
  return ip.slice(0, MAX_IP_LENGTH);
}

// Memoizes a connection. A failed connect is never cached: the next call retries.
export function createMemoizedConnector<T>(connect: () => Promise<T>): () => Promise<T> {
  let memo: Promise<T> | null = null;
  return () => {
    if (memo === null) {
      const attempt: Promise<T> = connect().catch((err: unknown) => {
        if (memo === attempt) memo = null;
        throw err;
      });
      memo = attempt;
    }
    return memo;
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) return undefined;
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return undefined;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createLiveHandlers(runtime: LiveRuntime) {
  async function POST(request: Request): Promise<Response> {
    try {
      const body = await readJsonBody(request);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return json(INVALID_BODY, 400);
      }
      const deps = await runtime.getDeps();
      if (deps === null) return send(liveUnavailable());
      const { code, icp } = body as { code?: unknown; icp?: unknown };
      return send(await runLive({ code, icp }, clientIp(request.headers), deps));
    } catch {
      return send(liveUnavailable());
    }
  }

  async function GET(request: Request): Promise<Response> {
    try {
      const [store, deps] = await Promise.all([runtime.getStore(), runtime.getDeps()]);
      if (store === null || deps === null) return send(liveUnavailable());
      const ipHash = hashIp(clientIp(request.headers), deps.hmacSecret);
      const rate = await store.hit(`status:${ipHash}`, deps.now(), STATUS_WINDOW_SECONDS, STATUS_LIMIT);
      if (!rate.allowed) {
        const seconds = Number.isFinite(rate.retryAfterSeconds)
          ? Math.max(1, Math.ceil(rate.retryAfterSeconds))
          : 60;
        return json(
          {
            status: "rate_limited",
            retryAfterSeconds: seconds,
            message: "Too many requests. Please wait before trying again.",
          },
          429,
        );
      }
      return json({ enabled: await store.isLiveEnabled() }, 200);
    } catch {
      return send(liveUnavailable());
    }
  }

  return { POST, GET };
}
