// The real adapter and the form store, with a fake fetch only: no test here
// can reach the network. Every fetch call is recorded, and an unexpected
// request fails the test.

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveFormView } from "../_components/LiveFormView";
import { LiveOutcome } from "../_components/LiveOutcome";
import {
  LIVE_RUN_ERROR_CODES,
  LIVE_RUN_HTTP_STATUS,
  type LiveRunErrorCode,
  type LiveRunRequest,
  SYNTHETIC_NOTICES,
} from "../_lib/contract";
import { buildPreviewFixtures } from "../_lib/fixtures";
import { createLiveApiAdapter, LIVE_RUN_PATH, LIVE_RUN_TIMEOUT_MS } from "../_lib/live-api";
import { createLiveRunStore, type LiveRunState, type LiveRunStore } from "../_lib/live-store";
import { ERROR_PRESENTATION, TIMEOUT_PRESENTATION } from "../_lib/messages";
import type { PreviewFixtures } from "../_lib/preview";
import { viewStateFor } from "../_lib/submission";

const CODE = "SECRET-CODE-7Q2X-9K4M";
const INDUSTRY = "Staffing and recruiting";
const REQUEST: LiveRunRequest = { code: CODE, icp: { industry: INDUSTRY, country: "India", sizes: ["11-50"] } };

interface Call {
  readonly url: unknown;
  readonly init: RequestInit;
}

type Handler = (call: Call) => Promise<Response> | Response;

let calls: Call[];
let handler: Handler;

function respond(handle: Handler) {
  handler = handle;
}
const json = (body: unknown, status: number) => () => new Response(JSON.stringify(body), { status });
const text = (body: string, status: number) => () => new Response(body, { status });
// A request that never answers, but rejects when aborted, like real fetch.
const hang: Handler = ({ init }) =>
  new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });

let fixtures: PreviewFixtures;
beforeAll(async () => {
  fixtures = await buildPreviewFixtures();
});

beforeEach(() => {
  calls = [];
  handler = () => {
    throw new Error("unexpected request");
  };
  vi.stubGlobal("fetch", (url: unknown, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return Promise.resolve().then(() => handler(call));
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fill(store: LiveRunStore) {
  store.setCode(CODE);
  store.setIndustry(INDUSTRY);
  store.setSize("11-50", true);
}

const render = (node: ReactElement) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const noop = () => {};

// Everything the page would render for a store state: the form and the outcome.
function page(state: LiveRunState): string {
  return [
    renderToStaticMarkup(
      createElement(LiveFormView, {
        values: state.values,
        errors: state.errors,
        submitting: state.view.kind === "loading",
        onCodeChange: noop,
        onIndustryChange: noop,
        onSizeChange: noop,
        onSubmit: noop,
      }),
    ),
    renderToStaticMarkup(
      createElement(LiveOutcome, {
        state: state.view,
        preview: false,
        elapsedSeconds: state.elapsedSeconds,
        onBack: noop,
        onRetry: noop,
      }),
    ),
  ].join("\n");
}

describe("the request", () => {
  it("is a same-origin JSON POST to /api/live/run with the agreed body, no cache and no credentials", async () => {
    respond(json(fixtures.success, 200));
    await createLiveApiAdapter().submit(REQUEST);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe("/api/live/run");
    expect(url).toBe(LIVE_RUN_PATH);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      code: CODE,
      icp: { industry: INDUSTRY, country: "India", sizes: ["11-50"] },
    });
    expect(Object.keys(JSON.parse(init.body as string))).toEqual(["code", "icp"]);
  });
});

describe("response statuses", () => {
  it("maps a success response to the success view", async () => {
    respond(json(fixtures.success, 200));
    const response = await createLiveApiAdapter().submit(REQUEST);
    expect(viewStateFor(response)).toEqual({
      kind: "success",
      response: JSON.parse(JSON.stringify(fixtures.success)),
      partial: false,
    });
  });

  it.each(LIVE_RUN_ERROR_CODES)("maps a %s response to its error view", async (code: LiveRunErrorCode) => {
    const body: Record<string, unknown> = { status: code, message: "Fixed server text." };
    if (code === "invalid_request") body.field = "industry";
    if (code === "rate_limited") body.retryAfterSeconds = 30;
    respond(json(body, LIVE_RUN_HTTP_STATUS[code]));
    const view = viewStateFor(await createLiveApiAdapter().submit(REQUEST));
    expect(view).toEqual({
      kind: "error",
      code,
      ...(code === "invalid_request" ? { field: "industry" } : {}),
      ...(code === "rate_limited" ? { retryAfterSeconds: 30 } : {}),
    });
  });
});

describe("malformed or unreadable responses", () => {
  const RAW = "TypeError: Cannot read properties of undefined (reading 'x') at handler (/var/task/route.js:1:1)";

  it.each([
    ["an HTML error page", text(`<html><body>502 Bad Gateway ${RAW}</body></html>`, 502)],
    ["invalid JSON", text(`{"status":"ok", ${RAW}`, 200)],
    ["an empty body", text("", 200)],
    ["a JSON array", json([RAW], 200)],
    ["an internal error object", json({ error: RAW, stack: RAW }, 500)],
    ["a success missing its parts", json({ status: "ok" }, 200)],
    ["a known status at the wrong HTTP status", json({ status: "invalid_code", message: RAW }, 500)],
    ["a body that fails while reading", () => new Response(new ReadableStream({ start: (c) => c.error(new Error(RAW)) }), { status: 200 })],
    ["a network failure", () => Promise.reject(new TypeError(`Failed to fetch ${RAW}`))],
  ] as const)("shows the fixed run-failed message for %s", async (_name, handle) => {
    respond(handle);
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    await store.submit();
    const { view } = store.getState();
    expect(view).toEqual({ kind: "error", code: "run_failed" });
    const shown = page(store.getState());
    expect(render(createElement(LiveOutcome, { state: view, preview: false, onBack: noop, onRetry: noop }))).toContain(
      ERROR_PRESENTATION.run_failed.message,
    );
    for (const leaked of ["TypeError", "/var/task", "502 Bad Gateway", "stack", "Cannot read", "Failed to fetch"]) {
      expect(shown).not.toContain(leaked);
    }
  });
});

describe("a submission", () => {
  it("renders the results and the server's notices after a success", async () => {
    respond(json(fixtures.success, 200));
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    await store.submit();
    expect(store.getState().view.kind).toBe("success");
    const shown = render(
      createElement(LiveOutcome, { state: store.getState().view, preview: false, onBack: noop, onRetry: noop }),
    );
    for (const notice of fixtures.success.notices) expect(shown).toContain(notice);
    for (const notice of SYNTHETIC_NOTICES) expect(shown).toContain(notice);
    expect(shown).toContain("Notices for this run");
    expect(shown).toContain("Demo data (synthetic)");
    for (const p of fixtures.success.results.prospects) expect(shown).toContain(p.display_name);
    // Real mode: no preview labels.
    expect(shown).not.toContain("Synthetic preview data");
    expect(shown).not.toContain("made-up preview value");
  });

  it("sends only one request for a double submission, even before React re-renders", async () => {
    respond(json(fixtures.success, 200));
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    const first = store.submit();
    const second = store.submit();
    const third = store.submit();
    await Promise.all([first, second, third]);
    expect(calls).toHaveLength(1);
    expect(store.getState().view.kind).toBe("success");
  });

  it("ignores a submission while one is running, without validating the cleared code", async () => {
    respond(hang);
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    void store.submit();
    expect(store.getState().view).toEqual({ kind: "loading" });
    await store.submit();
    expect(calls).toHaveLength(1);
    expect(store.getState().errors).toEqual({});
    expect(store.getState().view).toEqual({ kind: "loading" });
    store.cancel();
  });

  it("keeps the submit control disabled while loading", () => {
    respond(hang);
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    void store.submit();
    expect(page(store.getState())).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    store.cancel();
  });

  it("does not send an invalid form", async () => {
    const store = createLiveRunStore(createLiveApiAdapter());
    store.setIndustry(INDUSTRY);
    await store.submit();
    expect(calls).toHaveLength(0);
    expect(store.getState().errors.code).toBe("Enter your invitation code.");
  });
});

describe("loading and timeout", () => {
  it("shows elapsed time while waiting", async () => {
    vi.useFakeTimers();
    respond(hang);
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    void store.submit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.getState().elapsedSeconds).toBe(5);
    expect(render(createElement(LiveOutcome, { state: store.getState().view, preview: false, elapsedSeconds: 5, onBack: noop, onRetry: noop }))).toContain("0:05 elapsed");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.getState().elapsedSeconds).toBe(65);
    expect(store.getState().view.kind).toBe("loading");
    store.cancel();
  });

  it("times out after about two minutes with the warning, and never retries", async () => {
    vi.useFakeTimers();
    respond(hang);
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    void store.submit();
    expect(LIVE_RUN_TIMEOUT_MS).toBe(120_000);
    await vi.advanceTimersByTimeAsync(LIVE_RUN_TIMEOUT_MS - 1_000);
    expect(store.getState().view.kind).toBe("loading");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.getState().view).toEqual({ kind: "timeout" });
    const shown = render(createElement(LiveOutcome, { state: store.getState().view, preview: false, onBack: noop, onRetry: noop }));
    expect(shown).toContain(TIMEOUT_PRESENTATION.message);
    expect(shown).toContain("may already have used one of your available runs");
    expect(shown).not.toContain("Try again");

    // Nothing happens later: no retry, and the elapsed-time ticker stopped.
    const elapsed = store.getState().elapsedSeconds;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(1);
    expect(store.getState().elapsedSeconds).toBe(elapsed);
    expect(store.getState().view).toEqual({ kind: "timeout" });
  });

  it("stops waiting and clears the timer when cancelled, without showing an outcome", async () => {
    vi.useFakeTimers();
    respond(hang);
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    const pending = store.submit();
    await vi.advanceTimersByTimeAsync(2_000);
    store.cancel();
    await pending;
    expect(calls[0].init.signal?.aborted).toBe(true);
    expect(store.getState().view).toEqual({ kind: "idle" });
    await vi.advanceTimersByTimeAsync(LIVE_RUN_TIMEOUT_MS);
    expect(store.getState().view).toEqual({ kind: "idle" });
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timers behind after a run finishes", async () => {
    vi.useFakeTimers();
    respond(json(fixtures.success, 200));
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    await store.submit();
    expect(store.getState().view.kind).toBe("success");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("invitation-code privacy", () => {
  function spyStorage() {
    const storage = () => ({ setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 });
    const local = storage();
    const session = storage();
    const cookieWrites: string[] = [];
    const document = {};
    Object.defineProperty(document, "cookie", {
      get: () => "",
      set: (v: string) => cookieWrites.push(v),
    });
    const history = { pushState: vi.fn(), replaceState: vi.fn() };
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("document", document);
    vi.stubGlobal("history", history);
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    return { local, session, cookieWrites, history, logs };
  }

  it.each([
    ["a success", (): Handler => json(fixtures.success, 200)],
    ["an error", (): Handler => json({ status: "invalid_code", message: "That invite code is not valid." }, 401)],
    ["an unreadable response", (): Handler => text("<html>oops</html>", 502)],
  ] as const)("leaves the code out of the URL, storage, logs and the page after %s", async (_name, handle) => {
    respond(handle());
    const spies = spyStorage();
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    expect(store.getState().values.code).toBe(CODE);

    const pending = store.submit();
    // Cleared from the form as soon as the submission starts...
    expect(store.getState().values.code).toBe("");
    expect(page(store.getState())).not.toContain(CODE);
    await pending;

    // ...and it was sent only in the request body, never in the URL.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/live/run");
    expect(String(calls[0].url)).not.toContain(CODE);
    expect(JSON.parse(calls[0].init.body as string).code).toBe(CODE);

    expect(store.getState().values.code).toBe("");
    expect(store.getState().values.industry).toBe(INDUSTRY);
    expect(page(store.getState())).not.toContain(CODE);
    expect(JSON.stringify(store.getState())).not.toContain(CODE);

    expect(spies.local.setItem).not.toHaveBeenCalled();
    expect(spies.session.setItem).not.toHaveBeenCalled();
    expect(spies.cookieWrites).toEqual([]);
    expect(spies.history.pushState).not.toHaveBeenCalled();
    expect(spies.history.replaceState).not.toHaveBeenCalled();
    for (const log of spies.logs) expect(log).not.toHaveBeenCalled();
  });

  it("leaves the code out of the page after a timeout", async () => {
    vi.useFakeTimers();
    respond(hang);
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    void store.submit();
    await vi.advanceTimersByTimeAsync(LIVE_RUN_TIMEOUT_MS);
    expect(store.getState().view).toEqual({ kind: "timeout" });
    expect(page(store.getState())).not.toContain(CODE);
    expect(JSON.stringify(store.getState())).not.toContain(CODE);
  });

  it("asks for the code again to retry, since it was cleared", async () => {
    respond(json({ status: "rate_limited", retryAfterSeconds: 5, message: "Too many requests." }, 429));
    const store = createLiveRunStore(createLiveApiAdapter());
    fill(store);
    await store.submit();
    expect(store.getState().view).toEqual({ kind: "error", code: "rate_limited", retryAfterSeconds: 5 });
    await store.submit();
    expect(calls).toHaveLength(1);
    expect(store.getState().view).toEqual({ kind: "idle" });
    expect(store.getState().errors.code).toBe("Enter your invitation code.");
  });
});
