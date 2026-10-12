import { describe, expect, it, vi } from "vitest";
import { hashCode, hashIp } from "../../src/server/live/codes";
import { FakeLlmClient } from "../../src/core/agent/fake-llm";
import type { LlmClient } from "../../src/core/agent/llm";
import { FixtureProvider } from "../../src/core/data/fixture-provider";
import type { CompanyProvider } from "../../src/core/data/provider";
import { toLiveResultsDto } from "../../src/app/live/_lib/live-results";
import { readLiveConfig } from "../../src/server/live/config";
import { createLiveHandlers, createMemoizedConnector, type LiveRuntime } from "../../src/server/live/handlers";
import type { LiveDeps } from "../../src/server/live/run-live";
import type { HitResult, LiveStore } from "../../src/server/live/store";
import { FakeLiveStore } from "./fake-live-store";

vi.mock("server-only", () => ({}));

const SECRET = "hmac-secret-for-tests-0123456789abcdef";
const T0 = new Date("2026-01-01T00:00:00Z");
const ICP = { industry: "Staffing", country: "India", sizes: ["11-50"] };
const LEAK = "postgres://user:pw@db.internal/secret";
const UNAVAILABLE = {
  status: "live_unavailable",
  message: "Live mode is unavailable right now. Please try again later.",
};

function deps(store: LiveStore, extra: Partial<LiveDeps> = {}): LiveDeps {
  return {
    store,
    hmacSecret: SECRET,
    live: null,
    now: () => T0,
    createProvider: () => {
      throw new Error("createProvider must not be called");
    },
    createLlm: () => {
      throw new Error("createLlm must not be called");
    },
    toResults: () => ({}),
    ...extra,
  };
}

function runtimeOf(store: LiveStore | null, d: LiveDeps | null = store && deps(store)): LiveRuntime {
  return { getDeps: async () => d, getStore: async () => store };
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/live/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const get = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/live/status", { headers });

function expectHeaders(res: Response) {
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
}

describe("POST /api/live/run", () => {
  const h = createLiveHandlers(runtimeOf(new FakeLiveStore()));

  it("rejects an oversized body with 400", async () => {
    const res = await h.POST(post(JSON.stringify({ code: "x".repeat(5000), icp: ICP })));
    expect(res.status).toBe(400);
    expect((await res.json()).status).toBe("invalid_request");
    expectHeaders(res);
  });

  it("rejects an oversized Content-Length with 400", async () => {
    const res = await h.POST(post("{}", { "content-length": "5000" }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await h.POST(post("{nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: "invalid_request", field: "code" });
  });

  it("rejects a wrong content type with 400", async () => {
    const res = await h.POST(post("{}", { "content-type": "text/plain" }));
    expect(res.status).toBe(400);
  });

  it("derives the ip from x-real-ip, then x-forwarded-for, then unknown", async () => {
    const buckets: string[] = [];
    const store = new FakeLiveStore();
    const spy: LiveStore = Object.assign(Object.create(store) as LiveStore, {
      hit: async (b: string): Promise<HitResult> => {
        buckets.push(b);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    });
    const hh = createLiveHandlers(runtimeOf(spy));
    const body = JSON.stringify({ code: "NOPE", icp: ICP });
    await hh.POST(post(body, { "x-real-ip": " 1.1.1.1 ", "x-forwarded-for": "2.2.2.2" }));
    await hh.POST(post(body, { "x-forwarded-for": "2.2.2.2, 3.3.3.3" }));
    await hh.POST(post(body));
    await hh.POST(post(body, { "x-real-ip": "9".repeat(100) }));
    const ips = buckets.filter((b) => b.startsWith("ip:"));
    expect(ips).toEqual([
      `ip:${hashIp("1.1.1.1", SECRET)}`,
      `ip:${hashIp("2.2.2.2", SECRET)}`,
      `ip:${hashIp("unknown", SECRET)}`,
      `ip:${hashIp("9".repeat(64), SECRET)}`,
    ]);
  });

  it("carries the three headers on success and failure", async () => {
    const store = new FakeLiveStore();
    await store.admin.createCode("a", 1, hashCode("GOOD-CODE", SECRET));
    const hh = createLiveHandlers(runtimeOf(store));
    const ok = await hh.POST(post(JSON.stringify({ code: "GOOD-CODE", icp: ICP })));
    expect(ok.status).toBe(200);
    expectHeaders(ok);
    const bad = await hh.POST(post(JSON.stringify({ code: "BAD", icp: ICP })));
    expect(bad.status).toBe(401);
    expectHeaders(bad);
  });

  it("answers 503 live_unavailable when getDeps is null or throws", async () => {
    const body = JSON.stringify({ code: "X", icp: ICP });
    const nullRes = await createLiveHandlers(runtimeOf(null, null)).POST(post(body));
    expect(nullRes.status).toBe(503);
    expect(await nullRes.json()).toEqual(UNAVAILABLE);
    expectHeaders(nullRes);
    const throwing = createLiveHandlers({
      getDeps: async () => {
        throw new Error(LEAK);
      },
      getStore: async () => null,
    });
    const res = await throwing.POST(post(body));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(UNAVAILABLE);
  });

  it("never puts thrown error text in a response", async () => {
    const store = new FakeLiveStore();
    store.hit = async () => {
      throw new Error(LEAK);
    };
    const res = await createLiveHandlers(runtimeOf(store)).POST(post(JSON.stringify({ code: "X", icp: ICP })));
    expect(await res.text()).not.toContain("postgres");
    const g = await createLiveHandlers(runtimeOf(store)).GET(get());
    expect(await g.text()).not.toContain("postgres");
  });
});

describe("GET /api/live/status", () => {
  it("returns { enabled }", async () => {
    const store = new FakeLiveStore();
    await store.setLiveEnabled(true);
    const res = await createLiveHandlers(runtimeOf(store)).GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
    expectHeaders(res);
  });

  it("answers 503 on store failure or a null store", async () => {
    const store = new FakeLiveStore();
    store.isLiveEnabled = async () => {
      throw new Error(LEAK);
    };
    const failed = await createLiveHandlers(runtimeOf(store)).GET(get());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual(UNAVAILABLE);
    const none = await createLiveHandlers(runtimeOf(null, deps(store))).GET(get());
    expect(none.status).toBe(503);
  });

  it("answers 429 when the status hit is denied, using the hashed ip bucket", async () => {
    const store = new FakeLiveStore();
    const hit = vi.fn(async (): Promise<HitResult> => ({ allowed: false, retryAfterSeconds: 7 }));
    store.hit = hit;
    const res = await createLiveHandlers(runtimeOf(store)).GET(get({ "x-real-ip": "4.4.4.4" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ status: "rate_limited", retryAfterSeconds: 7 });
    expect(hit).toHaveBeenCalledWith(`status:${hashIp("4.4.4.4", SECRET)}`, T0, 60, 60);
  });
});

describe("runtime fail-safe", () => {
  const KEYS_ENV = {
    DATABASE_URL: "x://db",
    INVITE_HMAC_SECRET: SECRET,
    CRUSTDATA_LIVE_API_KEY: "k1",
    LIVE_LLM_API_KEY: "k2",
    LIVE_LLM_BASE_URL: "https://llm.example.test",
  };

  async function setup() {
    const mod = await import("../../src/app/api/live/_lib/runtime");
    const read = readLiveConfig(KEYS_ENV);
    if (!read.ok) throw new Error("config should be ok");
    expect(read.config.live).not.toBeNull();
    const store = new FakeLiveStore();
    await store.setLiveEnabled(true);
    await store.admin.createCode("live", 1, hashCode("LIVE-CODE", SECRET), "live");
    await store.admin.createCode("syn", 1, hashCode("SYNT-CODE", SECRET), "synthetic");
    return { ...mod, config: read.config, store };
  }

  function fakeFactories() {
    const createProvider = vi.fn<LiveDeps["createProvider"]>((_keys, config) => {
      const inner = new FixtureProvider({ config, cost_per_record: { search: 0.069, enrich: 0.6 } });
      const provider: CompanyProvider = {
        autocompleteIndustry: async () => ({ ok: true, data: ["Staffing and Recruiting"], cost_usd: 0, calls: 1 }),
        searchCompanies: (_f, limit) =>
          inner.searchCompanies({ country: "", industries: [], employee_count_ranges: [] }, limit),
        enrichCompanies: (urls) => inner.enrichCompanies(urls),
      };
      return { provider, budget: inner.budget };
    });
    const createLlm = vi.fn<LiveDeps["createLlm"]>((): LlmClient => new FakeLlmClient());
    return { createProvider, createLlm };
  }

  it("runs a live code through the injected live factories when a mapper is present", async () => {
    const { buildLiveDeps, LIVE_RESULTS_MAPPER, config, store } = await setup();
    expect(LIVE_RESULTS_MAPPER).toBe(toLiveResultsDto);
    const factories = fakeFactories();
    const built = { ...buildLiveDeps(config, store, LIVE_RESULTS_MAPPER), ...factories };
    expect(built.live).not.toBeNull();

    const res = await createLiveHandlers(runtimeOf(store, built)).POST(
      post(JSON.stringify({ code: "LIVE-CODE", icp: ICP })),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("live");
    expect(body.results.run.mode).toBe("live");
    expect(factories.createProvider).toHaveBeenCalledOnce();
    expect(factories.createLlm).toHaveBeenCalledOnce();
  });

  it("keeps live deps null and answers live_disabled when the mapper is null", async () => {
    const { buildLiveDeps, config, store } = await setup();
    const factories = fakeFactories();
    const built = { ...buildLiveDeps(config, store, null), ...factories };
    expect(built.live).toBeNull();

    const res = await createLiveHandlers(runtimeOf(store, built)).POST(
      post(JSON.stringify({ code: "LIVE-CODE", icp: ICP })),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "live_disabled" });
    expect(factories.createProvider).not.toHaveBeenCalled();
    expect(factories.createLlm).not.toHaveBeenCalled();
    const [run] = [...store.runs.values()].filter((r) => r.status === "released");
    expect(run.status).toBe("released");
    expect(() => built.toResults({} as never, { mode: "live", model: "m" })).toThrow();
  });

  it("returns the exact live-safe synthetic body shape through the real runLive path", async () => {
    const { buildLiveDeps, LIVE_RESULTS_MAPPER, config, store } = await setup();
    const built = buildLiveDeps(config, store, LIVE_RESULTS_MAPPER);
    const res = await createLiveHandlers(runtimeOf(store, built)).POST(
      post(JSON.stringify({ code: "SYNT-CODE", icp: ICP })),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(["mode", "notices", "results", "status", "usage"]);
    expect(body.usage).toEqual({ runsRemaining: 0 });
    expect(body.results.run).toMatchObject({
      mode: "synthetic",
      data_source: "fixtures",
      cost: { model_basis: "none", model_complete: true },
    });
    expect(text).not.toContain("actual_spend_usd");
    expect(text.toLowerCase()).not.toContain("crustdata");
  });
});

describe("createMemoizedConnector", () => {
  it("memoizes success and clears the memo after a failed connect", async () => {
    let calls = 0;
    const connect = createMemoizedConnector(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return { n: calls };
    });
    await expect(connect()).rejects.toThrow("boom");
    const first = await connect();
    const second = await connect();
    expect(first).toBe(second);
    expect(calls).toBe(2);
  });
});
