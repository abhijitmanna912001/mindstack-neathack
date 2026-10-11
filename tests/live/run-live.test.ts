import { type Mock, describe, expect, it, vi } from "vitest";
import { FakeLlmClient } from "../../src/core/agent/fake-llm";
import type { LlmClient } from "../../src/core/agent/llm";
import { FixtureProvider, type InjectedFailure } from "../../src/core/data/fixture-provider";
import type { PipelineResult } from "../../src/core/agent/types";
import type { CompanyProvider } from "../../src/core/data/provider";
import { runSyntheticPipeline, syntheticDependencies } from "../../src/app/results/_lib/synthetic-run";
import { hashCode } from "../../src/server/live/codes";
import type { LiveKeys } from "../../src/server/live/config";
import {
  LIVE_RUN_CONFIG,
  LIVE_SEARCH_SORT,
  type LiveDeps,
  type LiveOutcome,
  type ResultsContext,
  SYNTHETIC_NOTICES,
  scrubResult,
  liveUnavailable,
  runLive,
} from "../../src/server/live/run-live";
import { LiveStoreUnavailable, type LiveStore } from "../../src/server/live/store";
import { FakeLiveStore } from "./fake-live-store";

const SECRET = "hmac-secret-for-tests-0123456789abcdef";
const KEYS: LiveKeys = {
  crustdataApiKey: "crust-key-AAAA1111",
  llmApiKey: "llm-key-BBBB2222",
  llmBaseUrl: "https://llm.example.test/v1",
};
const CODE = "SYNT-CODE-0001-ABCD";
const LIVE_CODE = "LIVE-CODE-0002-EFGH";
const T0 = new Date("2026-01-01T00:00:00Z");
const ICP = { industry: "Staffing", country: "India", sizes: ["11-50", "51-200"] };
const IP = "203.0.113.9";

interface Harness {
  store: FakeLiveStore;
  deps: LiveDeps;
  createProvider: Mock<LiveDeps["createProvider"]>;
  createLlm: Mock<LiveDeps["createLlm"]>;
  toResults: Mock<(result: PipelineResult, ctx: ResultsContext) => unknown>;
  autocomplete: Mock<(query: string) => void>;
}

interface Options {
  failures?: InjectedFailure[];
  suggestions?: readonly string[] | "no_match" | "failed";
  dropOneEnriched?: boolean;
  live?: LiveKeys | null;
  createProviderThrows?: boolean;
  toResultsThrows?: boolean;
}

// A fixture-backed stand-in for the Crustdata provider: its autocomplete is
// scripted, and searches ignore the filters so the fixtures always match.
function liveProvider(options: Options, autocomplete: Mock<(query: string) => void>) {
  const inner = new FixtureProvider({
    config: LIVE_RUN_CONFIG,
    cost_per_record: { search: 0.069, enrich: 0.6 },
    failures: options.failures,
  });
  const provider: CompanyProvider = {
    async autocompleteIndustry(query) {
      autocomplete(query);
      const s = options.suggestions ?? ["Staffing and Recruiting"];
      if (s === "no_match") return { ok: false, error: { category: "no_match", message: "none" } };
      if (s === "failed") return { ok: false, error: { category: "timeout", message: "upstream said KEY" } };
      return { ok: true, data: s, cost_usd: 0, calls: 1 };
    },
    searchCompanies: (_f, limit) =>
      inner.searchCompanies({ country: "", industries: [], employee_count_ranges: [] }, limit),
    async enrichCompanies(urls) {
      const res = await inner.enrichCompanies(urls);
      if (res.ok && options.dropOneEnriched) return { ...res, data: res.data.slice(0, -1) };
      return res;
    },
  };
  return { provider, budget: inner.budget };
}

async function harness(options: Options = {}): Promise<Harness> {
  const store = new FakeLiveStore();
  await store.setLiveEnabled(true);
  await store.admin.createCode("syn", 3, hashCode(CODE, SECRET), "synthetic");
  await store.admin.createCode("live", 3, hashCode(LIVE_CODE, SECRET), "live");
  const autocomplete = vi.fn<(query: string) => void>();
  const createProvider = vi.fn<LiveDeps["createProvider"]>((keys, config) => {
    expect(config).toEqual(LIVE_RUN_CONFIG);
    expect(keys).toEqual(KEYS);
    if (options.createProviderThrows) throw new Error(`boom ${keys.crustdataApiKey}`);
    return liveProvider(options, autocomplete);
  });
  const createLlm = vi.fn<LiveDeps["createLlm"]>((): LlmClient => new FakeLlmClient());
  const toResults = vi.fn((result: PipelineResult, ctx: ResultsContext) => {
    if (options.toResultsThrows) throw new Error(`mapper boom ${KEYS.llmApiKey}`);
    return {
      fakeResults: true,
      mode: ctx.mode,
      model: ctx.model,
      prospects: result.prospects.length,
      searched: result.usage.provider.searched,
      issueCodes: result.issues.map((i) => i.code),
    };
  });
  const deps: LiveDeps = {
    store,
    hmacSecret: SECRET,
    live: options.live === undefined ? KEYS : options.live,
    now: () => T0,
    createProvider,
    createLlm,
    toResults,
  };
  return { store, deps, createProvider, createLlm, toResults, autocomplete };
}

const go = (h: Harness, code: unknown = CODE, icp: unknown = ICP, ip = IP): Promise<LiveOutcome> =>
  runLive({ code, icp }, ip, h.deps);

function expectNoLeaks(outcome: LiveOutcome, extra: string[] = []) {
  const text = JSON.stringify(outcome.body);
  for (const secret of [SECRET, KEYS.crustdataApiKey, KEYS.llmApiKey, CODE, LIVE_CODE, ...extra]) {
    expect(text).not.toContain(secret);
  }
  expect(text).not.toMatch(/\bat \S+\.(ts|js):\d+/);
}

type OkBody = Extract<LiveOutcome["body"], { status: "ok" }>;
function okBody(out: LiveOutcome): OkBody {
  expect(out.body.status).toBe("ok");
  return out.body as OkBody;
}

function onlyRun(h: Harness) {
  expect(h.store.runs.size).toBe(1);
  return [...h.store.runs.values()][0];
}

describe("runLive: request validation and limits", () => {
  it("returns 400 invalid_request before touching the store", async () => {
    const h = await harness();
    const hit = vi.spyOn(h.store, "hit");
    const out = await go(h, CODE, { ...ICP, country: "Nepal" });
    expect(out.httpStatus).toBe(400);
    expect(out.body).toMatchObject({ status: "invalid_request", field: "country" });
    expect(typeof (out.body as { message: string }).message).toBe("string");
    expect(hit).not.toHaveBeenCalled();
  });

  it("rate limits by IP: the 21st request in a window gets 429", async () => {
    const h = await harness();
    let last: LiveOutcome | undefined;
    for (let i = 0; i < 21; i++) last = await go(h, "bad-code-" + i);
    expect(last!.httpStatus).toBe(429);
    expect(last!.body).toMatchObject({ status: "rate_limited" });
    expect((last!.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("returns 503 live_disabled for a live code when the switch is off, and gives the run back", async () => {
    const h = await harness();
    await h.store.setLiveEnabled(false);
    const release = vi.spyOn(h.store, "releaseRun");
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(503);
    expect(out.body).toMatchObject({ status: "live_disabled" });
    expect(release).toHaveBeenCalledOnce();
    expect(onlyRun(h).status).toBe("released");
    expect(h.createProvider).not.toHaveBeenCalled();
    expect(h.toResults).not.toHaveBeenCalled();
  });

  it("runs a synthetic code normally when the switch is off, never reading the switch", async () => {
    const h = await harness();
    await h.store.setLiveEnabled(false);
    const enabled = vi.spyOn(h.store, "isLiveEnabled");
    const out = await go(h);
    expect(out.httpStatus).toBe(200);
    expect(out.body).toMatchObject({ status: "ok", mode: "synthetic" });
    expect(enabled).not.toHaveBeenCalled();
    expect(onlyRun(h).status).toBe("completed");
  });

  it("runs a live code when the switch is on", async () => {
    const h = await harness();
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(200);
    expect(out.body).toMatchObject({ status: "ok", mode: "live" });
  });

  it("releases the run and gives 503 live_unavailable when reading the switch fails after reservation", async () => {
    const h = await harness();
    h.store.isLiveEnabled = async () => {
      throw new LiveStoreUnavailable();
    };
    const release = vi.spyOn(h.store, "releaseRun");
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(503);
    expect(out.body).toMatchObject({ status: "live_unavailable" });
    expect(release).toHaveBeenCalledOnce();
    expect(onlyRun(h).status).toBe("released");
    expect(h.createProvider).not.toHaveBeenCalled();
  });
});

describe("runLive: reservation failures", () => {
  it("gives identical 401 bodies for unknown, malformed and disabled codes", async () => {
    const h = await harness();
    await h.store.admin.disableCode("syn");
    const bodies = [];
    for (const [i, code] of ["UNKNOWN-CODE-XYZ", "!!!???", CODE].entries()) {
      const out = await go(h, code, ICP, `198.51.100.${i}`);
      expect(out.httpStatus).toBe(401);
      bodies.push(JSON.stringify(out.body));
    }
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toMatchObject({ status: "invalid_code" });
  });

  it("limits bad codes per IP: the 6th wrong code in 15 minutes gets 429", async () => {
    const h = await harness();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await go(h, `WRONG-${i}`)).httpStatus);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    // A different IP is unaffected.
    expect((await go(h, "WRONG-X", ICP, "198.51.100.77")).httpStatus).toBe(401);
  });

  it("does not count successful runs towards the bad-code limit", async () => {
    const h = await harness();
    const hit = vi.spyOn(h.store, "hit");
    await go(h);
    expect(hit.mock.calls.map((c) => String(c[0]).split(":")[0])).toEqual(["ip"]);
  });

  it("returns 403 no_runs_left", async () => {
    const h = await harness();
    await h.store.admin.createCode("empty", 0, hashCode("EMPTY-CODE", SECRET));
    const out = await go(h, "EMPTY-CODE");
    expect(out.httpStatus).toBe(403);
    expect(out.body).toMatchObject({ status: "no_runs_left" });
  });

  it("returns 409 run_in_progress while a run holds the lock", async () => {
    const h = await harness();
    await h.store.reserveRun(hashCode(CODE, SECRET), T0, 330);
    const out = await go(h);
    expect(out.httpStatus).toBe(409);
    expect(out.body).toMatchObject({ status: "run_in_progress" });
  });
});

describe("runLive: fail closed", () => {
  function brokenStore(h: Harness, method: keyof LiveStore): void {
    (h.store as unknown as Record<string, unknown>)[method] = async () => {
      throw new LiveStoreUnavailable();
    };
  }

  it.each(["hit", "isLiveEnabled", "reserveRun"] as const)(
    "returns 503 live_unavailable when store.%s fails, and constructs nothing",
    async (method) => {
      const h = await harness();
      brokenStore(h, method);
      const out = await go(h, LIVE_CODE);
      expect(out.httpStatus).toBe(503);
      expect(out.body).toMatchObject({ status: "live_unavailable" });
      expect(h.createProvider).not.toHaveBeenCalled();
      expect(h.createLlm).not.toHaveBeenCalled();
      expectNoLeaks(out);
    },
  );

  it("returns 503 live_unavailable for an unusable HMAC secret", async () => {
    const h = await harness();
    const out = await runLive({ code: CODE, icp: ICP }, IP, { ...h.deps, hmacSecret: "short" });
    expect(out.httpStatus).toBe(503);
    expect(out.body).toMatchObject({ status: "live_unavailable" });
  });

  it("exports a fixed live_unavailable outcome for callers without configuration", () => {
    expect(liveUnavailable().httpStatus).toBe(503);
    expect(liveUnavailable().body).toMatchObject({ status: "live_unavailable" });
  });

  it("still gives 502 run_failed when a failed run's finishRun also throws", async () => {
    const h = await harness({ toResultsThrows: true });
    const finish = vi.fn(async () => {
      throw new LiveStoreUnavailable();
    });
    h.store.finishRun = finish;
    const out = await go(h);
    expect(out.httpStatus).toBe(502);
    expect(out.body).toMatchObject({ status: "run_failed" });
    expect(finish).toHaveBeenCalledOnce();
  });
});

describe("runLive: bookkeeping failures on a completed run", () => {
  it.each([
    ["synthetic", CODE],
    ["live", LIVE_CODE],
  ] as const)("retries finishRun once and returns 200 (%s)", async (_mode, code) => {
    const h = await harness();
    const real = h.store.finishRun.bind(h.store);
    let calls = 0;
    const finish = vi.fn(async (id: string, outcome: Parameters<LiveStore["finishRun"]>[1]) => {
      if (++calls === 1) throw new LiveStoreUnavailable();
      return real(id, outcome);
    });
    h.store.finishRun = finish;
    const out = await go(h, code);
    expect(out.httpStatus).toBe(200);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(finish.mock.calls.every(([, o]) => o.status === "completed")).toBe(true);
    expect(onlyRun(h).status).toBe("completed");
  });

  it.each([
    ["synthetic", CODE],
    ["live", LIVE_CODE],
  ] as const)("still returns 200 with the results when finishRun always throws (%s)", async (_mode, code) => {
    const h = await harness();
    const finish = vi.fn<LiveStore["finishRun"]>(async () => {
      throw new LiveStoreUnavailable();
    });
    h.store.finishRun = finish;
    const out = await go(h, code);
    expect(out.httpStatus).toBe(200);
    expect(okBody(out).results).toMatchObject({ fakeResults: true });
    expect(finish).toHaveBeenCalledTimes(2);
    expect(finish.mock.calls.every(([, o]) => o.status === "completed")).toBe(true);
    expectNoLeaks(out);
  });
});

describe("scrubResult", () => {
  const MARK = "UPSTREAM-LEAK";

  async function pipelineResult(): Promise<PipelineResult> {
    const run = await runSyntheticPipeline("synthetic", syntheticDependencies);
    if (run.kind !== "ok") throw new Error("synthetic run rejected");
    return run.result;
  }

  // Every scrubbed field carries the marker.
  function poisoned(base: PipelineResult): PipelineResult {
    const [first, ...rest] = base.prospects;
    const finding = { code: "unsupported_number" as const, severity: "error" as const, message: MARK, fact_id: MARK, criterion: MARK };
    const dirty = {
      ...first,
      assessment: { status: "failed" as const, reason: "llm_error" as const, message: MARK, error_category: "model_error" as const },
      search_validation: { status: "flagged" as const, issues: [{ code: "junk_website" as const, field: "website", reason: MARK }] },
      validation: { status: "flagged" as const, issues: [{ code: "missing_linkedin" as const, field: "professional_network_url", reason: MARK }] },
      checks: {
        assessment: { ok: false, findings: [finding] },
        claims: { ok: false, findings: [{ ...finding, code: "unknown_citation" as const }] },
        outreach: "removed" as const,
      },
    };
    return {
      ...base,
      run: { ...base.run, input_description: MARK },
      issues: [
        { step: "search", code: "search_failed", message: MARK },
        { step: "enrich", code: "enrich_partial", message: MARK },
      ],
      prospects: [dirty, ...rest],
    };
  }

  it("replaces every upstream-capable field with fixed text and does not mutate its input", async () => {
    const input = poisoned(await pipelineResult());
    const before = JSON.stringify(input);
    expect(before).toContain(MARK);
    const out = scrubResult(input);
    expect(JSON.stringify(out)).not.toContain(MARK);
    expect(JSON.stringify(input)).toBe(before);
    expect(out).not.toBe(input);
    expect(out.issues[1].message).toBe("Some companies could not be enriched, so those use basic search data only.");
    expect(out.prospects[0].assessment).toMatchObject({ status: "failed", message: "The model could not assess this company." });
    expect(out.prospects.length).toBe(input.prospects.length);
  });

  it("uses a generic fixed text for unknown codes and reasons", async () => {
    const base = await pipelineResult();
    const odd = {
      ...base,
      issues: [{ step: "search", code: "brand_new_code", message: MARK }],
      prospects: [{ ...base.prospects[0], assessment: { status: "failed", reason: "brand_new_reason", message: MARK } }],
    } as unknown as PipelineResult;
    const out = scrubResult(odd);
    expect(JSON.stringify(out)).not.toContain(MARK);
    expect(out.issues[0].message).toBe("A step of the run reported a problem.");
    expect(out.prospects[0].assessment).toMatchObject({ message: "The assessment failed." });
  });

  it("passes company data and model assessments through unchanged", async () => {
    const base = await pipelineResult();
    const out = scrubResult(base);
    expect(out.prospects.map((p) => p.raw)).toEqual(base.prospects.map((p) => p.raw));
    expect(out.prospects.map((p) => p.facts)).toEqual(base.prospects.map((p) => p.facts));
    expect(out.usage).toEqual(base.usage);
  });

  it("hands toResults a scrubbed result in both modes", async () => {
    for (const code of [CODE, LIVE_CODE]) {
      const h = await harness();
      const leaky = (): LlmClient => ({
        records_llm_spans: false,
        complete: () => {
          throw new Error(MARK);
        },
      });
      h.createLlm.mockImplementation(leaky);
      const deps: LiveDeps = { ...h.deps, synthetic: { ...syntheticDependencies, createLlm: leaky } };
      const out = await runLive({ code, icp: ICP }, IP, deps);
      expect(out.httpStatus).toBe(200);
      const [arg] = h.toResults.mock.calls[0];
      expect(arg.prospects.some((p) => p.assessment.status === "failed")).toBe(true);
      expect(JSON.stringify(arg)).not.toContain(MARK);
    }
  });
});

describe("runLive: synthetic mode", () => {
  it("runs the synthetic pipeline, never builds live dependencies, and needs no live config", async () => {
    const h = await harness({ live: null });
    const out = await go(h);
    expect(out.httpStatus).toBe(200);
    expect(h.createProvider).not.toHaveBeenCalled();
    expect(h.createLlm).not.toHaveBeenCalled();
    expect(out.body).toMatchObject({ status: "ok", mode: "synthetic" });
    const body = out.body as Extract<typeof out.body, { status: "ok" }>;
    expect(body.notices).toEqual(expect.arrayContaining([...SYNTHETIC_NOTICES]));
    expect(body.results).toMatchObject({ fakeResults: true, mode: "synthetic", model: "fake" });
    expect((body.results as { prospects: number }).prospects).toBeGreaterThan(0);
    expect(body.usage).toMatchObject({ runsRemaining: 2, providerCostUsd: 0 });
    expect(body.usage.searched).toBe((body.results as { searched: number }).searched);
    expect(onlyRun(h).status).toBe("completed");
    expectNoLeaks(out);
  });

  it("calls toResults once with the synthetic ctx and a pipeline result", async () => {
    const h = await harness();
    await go(h);
    expect(h.toResults).toHaveBeenCalledOnce();
    const [result, ctx] = h.toResults.mock.calls[0];
    expect(ctx).toEqual({ mode: "synthetic", model: "fake" });
    expect(result.prospects.length).toBeGreaterThan(0);
  });

  it("fails with 502 and finishes the run if toResults throws, without leaking", async () => {
    const h = await harness({ toResultsThrows: true });
    const out = await go(h);
    expect(out.httpStatus).toBe(502);
    expect(out.body).toMatchObject({ status: "run_failed" });
    expect(onlyRun(h).status).toBe("failed");
    expectNoLeaks(out);
  });

  it("ignores the ICP: any valid criteria give the same results", async () => {
    const a = await go(await harness(), CODE, ICP);
    const b = await go(await harness(), CODE, { industry: "Robotics", country: "India", sizes: ["51-200"] });
    expect(JSON.stringify((a.body as { results: unknown }).results)).toBe(
      JSON.stringify((b.body as { results: unknown }).results),
    );
  });

  it("always carries both fixed notices", async () => {
    const out = await go(await harness());
    const notices = okBody(out).notices;
    expect(notices.slice(0, 2)).toEqual([
      "Synthetic demo: fixture companies and a fake model; your search criteria were not used.",
      "One outreach draft deliberately contains an injected unsupported number so you can see the claim check suppress it.",
    ]);
  });

  it("fails with 502 and finishes the run if the synthetic pipeline throws", async () => {
    const h = await harness();
    const deps: LiveDeps = {
      ...h.deps,
      synthetic: {
        createProvider: () => {
          throw new Error("explode");
        },
        createLlm: () => new FakeLlmClient(),
      },
    };
    const out = await runLive({ code: CODE, icp: ICP }, IP, deps);
    expect(out.httpStatus).toBe(502);
    expect(out.body).toMatchObject({ status: "run_failed" });
    expect(onlyRun(h).status).toBe("failed");
  });
});

describe("runLive: live mode", () => {
  it("builds the provider and model client from config, uses the first autocomplete suggestion, and completes", async () => {
    const h = await harness({ suggestions: ["Staffing and Recruiting", "Other"] });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(200);
    expect(h.createProvider).toHaveBeenCalledOnce();
    expect(h.createLlm).toHaveBeenCalledOnce();
    expect(h.autocomplete).toHaveBeenCalledWith("Staffing");
    const body = out.body as Extract<typeof out.body, { status: "ok" }>;
    expect(body.mode).toBe("live");
    expect(body.results).toMatchObject({ fakeResults: true, mode: "live", model: "claude-haiku" });
    expect(body.notices.some((n) => n.includes("Staffing and Recruiting"))).toBe(true);
    expect(body.notices.some((n) => n.startsWith("Synthetic demo"))).toBe(false);
    expect(body.usage.searched).toBe(10);
    expect(body.usage.enriched).toBeGreaterThan(0);
    expect(body.usage.providerCostUsd).toBeGreaterThan(0);
    expect(body.usage.runsRemaining).toBe(2);
    const run = onlyRun(h);
    expect(run.status).toBe("completed");
    expect(run.outcome?.searched).toBe(10);
    expectNoLeaks(out);
  });

  it("calls toResults once with the live ctx and never with mode synthetic", async () => {
    const h = await harness();
    await go(h, LIVE_CODE);
    expect(h.toResults).toHaveBeenCalledOnce();
    expect(h.toResults.mock.calls[0][1]).toEqual({ mode: "live", model: "claude-haiku" });
    expect(h.toResults.mock.calls.some(([, ctx]) => ctx.mode === "synthetic")).toBe(false);
  });

  it("does not call toResults when a live run is released or stopped", async () => {
    for (const options of [{ suggestions: "failed" as const }, { failures: [{ call_number: 1, category: "budget_cap_reached" as const }] }]) {
      const h = await harness(options);
      await go(h, LIVE_CODE);
      expect(h.toResults).not.toHaveBeenCalled();
    }
  });

  it("finishes a live run as failed with its measured counts if toResults throws", async () => {
    const h = await harness({ toResultsThrows: true });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(502);
    expect(out.body).toMatchObject({ status: "run_failed" });
    expect(onlyRun(h).status).toBe("failed");
    expect(onlyRun(h).outcome?.searched).toBe(10);
    expectNoLeaks(out);
  });

  it("pins the run config and search sort the spec requires", () => {
    expect(LIVE_RUN_CONFIG).toMatchObject({
      max_search_results: 10,
      max_enrichments: 5,
      model: "claude-haiku",
      max_llm_calls_per_run: 20,
      max_output_tokens_per_call: 1500,
    });
    expect(LIVE_SEARCH_SORT).toEqual({ field: "crustdata_company_id", order: "asc" });
  });

  it("releases the run and returns 400 on field industry when nothing matches", async () => {
    const h = await harness({ suggestions: "no_match" });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(400);
    expect(out.body).toMatchObject({ status: "invalid_request", field: "industry" });
    expect(onlyRun(h).status).toBe("released");
    // The run was given back.
    const again = await go(await harness({ suggestions: "no_match" }), LIVE_CODE);
    expect(again.httpStatus).toBe(400);
  });

  it("releases the run (no finishRun) on autocomplete failure", async () => {
    const h = await harness({ suggestions: "failed" });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(502);
    expect(out.body).toMatchObject({ status: "run_failed" });
    expect(onlyRun(h).status).toBe("released");
    expectNoLeaks(out, ["upstream said KEY"]);
  });

  it("releases the run when live configuration is missing", async () => {
    const h = await harness({ live: null });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(502);
    expect(out.body).toMatchObject({ status: "run_failed" });
    expect(h.createProvider).not.toHaveBeenCalled();
    expect(onlyRun(h).status).toBe("released");
  });

  it("releases the run when a factory throws, without leaking the error", async () => {
    const h = await harness({ createProviderThrows: true });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(502);
    expect(onlyRun(h).status).toBe("released");
    expectNoLeaks(out);
  });

  it("maps a provider budget_cap_reached before any result to 503 budget_exhausted", async () => {
    const h = await harness({ failures: [{ call_number: 1, category: "budget_cap_reached" }] });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(503);
    expect(out.body).toMatchObject({ status: "budget_exhausted" });
    expect(onlyRun(h).status).toBe("budget_exhausted");
    expect(onlyRun(h).outcome?.errorCategory).toBe("budget_cap_reached");
    expectNoLeaks(out);
  });

  it("maps any other provider failure to 502 run_failed", async () => {
    const h = await harness({ failures: [{ call_number: 1, category: "auth_failed", message: "bad key crust-key-AAAA1111" }] });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(502);
    expect(out.body).toMatchObject({ status: "run_failed" });
    expect(onlyRun(h).status).toBe("failed");
    expectNoLeaks(out);
  });

  it("absorbs model errors per company and never echoes their text", async () => {
    const h = await harness();
    h.createLlm.mockImplementation(() => ({
      records_llm_spans: false,
      complete: () => {
        throw new Error("model blew up llm-key-BBBB2222");
      },
    }));
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(200);
    expect(onlyRun(h).status).toBe("completed");
    expect(JSON.stringify(out.body)).not.toContain("model blew up");
    expectNoLeaks(out);
  });

  it("adds a notice for partial enrichment", async () => {
    const h = await harness({ dropOneEnriched: true });
    const out = await go(h, LIVE_CODE);
    expect(out.httpStatus).toBe(200);
    const notices = okBody(out).notices;
    expect(notices).toContain("Some companies could not be enriched, so those use basic search data only.");
  });

  it("sends the matched industry, sizes and country to the pipeline", async () => {
    const h = await harness({ suggestions: ["Staffing and Recruiting"] });
    const out = await go(h, LIVE_CODE, { industry: "Staffing", country: "India", sizes: ["51-200"] });
    expect(out.httpStatus).toBe(200);
    const issues = (okBody(out).results as { issueCodes: string[] }).issueCodes;
    expect(issues).not.toContain("industry_not_recognised");
  });
});

describe("runLive: no leaks", () => {
  it("never puts keys, codes, the HMAC secret or upstream text in any response body", async () => {
    const scenarios: Array<() => Promise<LiveOutcome>> = [
      async () => go(await harness(), CODE),
      async () => go(await harness(), LIVE_CODE),
      async () => go(await harness(), "WRONG-" + LIVE_CODE),
      async () => go(await harness({ suggestions: "failed" }), LIVE_CODE),
      async () => go(await harness({ suggestions: "no_match" }), LIVE_CODE),
      async () => go(await harness({ failures: [{ call_number: 1, category: "budget_cap_reached" }] }), LIVE_CODE),
      async () => go(await harness({ createProviderThrows: true }), LIVE_CODE),
      async () => {
        const h = await harness();
        await h.store.setLiveEnabled(false);
        return go(h, LIVE_CODE);
      },
      async () => go(await harness(), LIVE_CODE, { ...ICP, industry: LIVE_CODE }),
    ];
    for (const run of scenarios) expectNoLeaks(await run());
  });

  it("gives every non-200 body a status and a fixed message string", async () => {
    const h = await harness();
    await h.store.setLiveEnabled(false);
    const outcomes = [
      await go(h, CODE, { ...ICP, sizes: [] }),
      await go(h, LIVE_CODE),
      await go(await harness(), "nope"),
    ];
    for (const o of outcomes) {
      expect(o.httpStatus).not.toBe(200);
      expect(typeof (o.body as { message: string }).message).toBe("string");
      expect((o.body as { message: string }).message.length).toBeGreaterThan(0);
    }
  });
});
