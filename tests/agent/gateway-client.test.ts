// The real model client against a mocked transport. Every HTTP request goes
// to an in-memory fetch: no gateway, no key, no neatlogs export (tracing is
// never initialised, so wrapOpenAI's spans are not recorded anywhere).

import { wrapOpenAI } from "neatlogs/openai";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { defaultFakeAssessment } from "../../src/core/agent/fake-llm";
import {
  createGatewayLlmClient,
  createGatewayOpenAIClient,
} from "../../src/core/agent/gateway-client";
import type { LlmRequest, LlmResponse } from "../../src/core/agent/llm";
import {
  LITELLM_GATEWAY_BASE_URL,
  LLM_MAX_RETRIES,
  LLM_REQUEST_TIMEOUT_MS,
} from "../../src/core/agent/llm-policy";
import {
  OpenAiCompatibleLlmClient,
  redactSecrets,
  retryAfterMs,
} from "../../src/core/agent/openai-llm";
import { runBaselinePipeline } from "../../src/core/agent/pipeline";
import { DEV_RUN_CONFIG } from "../../src/core/types";
import { OPEN_ICP, flattenSpans, harness } from "./helpers";

vi.mock("neatlogs/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("neatlogs/openai")>();
  return { ...actual, wrapOpenAI: vi.fn(actual.wrapOpenAI) };
});

const API_KEY = "sk-test-0123456789abcdef";

const REQUEST: LlmRequest = {
  model: DEV_RUN_CONFIG.model,
  messages: [
    { role: "system", content: "Reply with JSON." },
    { role: "user", content: "Assess company 1001." },
  ],
  max_output_tokens: DEV_RUN_CONFIG.max_output_tokens_per_call,
  temperature: 0,
};

interface SentRequest {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

type Responder = (body: Record<string, unknown>, init: RequestInit | undefined) => Response | Promise<Response>;

// In-memory fetch: answers the Nth request with responders[N] (the last one
// repeats) and records what was sent.
function mockFetch(...responders: Responder[]) {
  const sent: SentRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    sent.push({ url: String(input instanceof Request ? input.url : input), body });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await Promise.resolve();
      return await responders[Math.min(sent.length - 1, responders.length - 1)](body, init);
    } finally {
      inFlight -= 1;
    }
  };
  return {
    fetch,
    sent,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

function completion(
  options: {
    content?: string | null;
    usage?: { prompt_tokens: number; completion_tokens: number } | null;
    finish_reason?: string;
    headers?: Record<string, string>;
    choices?: unknown[];
  } = {},
): Response {
  const usage =
    options.usage === null
      ? undefined
      : { total_tokens: 0, ...(options.usage ?? { prompt_tokens: 1000, completion_tokens: 500 }) };
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "gateway-model",
      choices: options.choices ?? [
        {
          index: 0,
          finish_reason: options.finish_reason ?? "stop",
          message: { role: "assistant", content: options.content === undefined ? "{}" : options.content },
        },
      ],
      ...(usage ? { usage } : {}),
    }),
    { status: 200, headers: { "content-type": "application/json", ...options.headers } },
  );
}

function errorResponse(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Records requested waits instead of sleeping.
function recordingSleep() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

function gatewayClient(fetch: ReturnType<typeof mockFetch>["fetch"], extra: Partial<Parameters<typeof createGatewayLlmClient>[0]> = {}) {
  const { sleep, waits } = recordingSleep();
  const llm = createGatewayLlmClient({ apiKey: API_KEY, fetch, sleep, ...extra });
  return { llm, waits };
}

function expectNoSecrets(response: LlmResponse): void {
  const text = JSON.stringify(response);
  expect(text).not.toContain(API_KEY);
  expect(text).not.toMatch(/Bearer\s+(?!\[redacted\])/i);
}

describe("createGatewayOpenAIClient", () => {
  it("wraps the SDK client with neatlogs wrapOpenAI", () => {
    vi.mocked(wrapOpenAI).mockClear();
    const { client } = createGatewayOpenAIClient({ apiKey: API_KEY, fetch: mockFetch().fetch });
    expect(wrapOpenAI).toHaveBeenCalledTimes(1);
    expect(vi.mocked(wrapOpenAI).mock.calls[0][0]).toBeInstanceOf(OpenAI);
    expect(vi.mocked(wrapOpenAI).mock.results[0].value).toBe(client);
  });

  it("disables SDK retries and sets the gateway URL and a 30 s timeout", () => {
    const { client } = createGatewayOpenAIClient({ apiKey: API_KEY, fetch: mockFetch().fetch });
    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(LLM_REQUEST_TIMEOUT_MS);
    expect(LLM_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(client.baseURL).toBe(LITELLM_GATEWAY_BASE_URL);
    expect(LITELLM_GATEWAY_BASE_URL).toBe("https://litellm.vision.aivar.app/v1");
  });

  it("accepts an explicit timeout and base URL", () => {
    const { client } = createGatewayOpenAIClient({
      apiKey: API_KEY,
      fetch: mockFetch().fetch,
      timeoutMs: 5_000,
      baseURL: "https://gateway.invalid/v1",
    });
    expect(client.timeout).toBe(5_000);
    expect(client.baseURL).toBe("https://gateway.invalid/v1");
  });

  it("refuses to build without an API key, without echoing input", () => {
    expect(() => createGatewayOpenAIClient({ apiKey: "  " })).toThrow("The model gateway API key is missing.");
  });

  // Verified against the installed neatlogs: its traced create() returns a
  // plain Promise, so withResponse() is unavailable once wrapped.
  it("loses withResponse() once wrapped, which is why the fetch hook exists", () => {
    const { client } = createGatewayOpenAIClient({
      apiKey: API_KEY,
      fetch: mockFetch(() => completion()).fetch,
    });
    const pending = client.chat.completions.create({ model: "m", messages: [] });
    expect((pending as { withResponse?: unknown }).withResponse).toBeUndefined();
    return pending;
  });
});

describe("OpenAiCompatibleLlmClient: request", () => {
  it("sends the configured model, temperature 0 and the output-token limit", async () => {
    const transport = mockFetch(() => completion());
    const { llm } = gatewayClient(transport.fetch);
    await llm.complete(REQUEST);

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].url).toBe(`${LITELLM_GATEWAY_BASE_URL}/chat/completions`);
    expect(transport.sent[0].body).toEqual({
      model: DEV_RUN_CONFIG.model,
      messages: REQUEST.messages,
      max_tokens: DEV_RUN_CONFIG.max_output_tokens_per_call,
      temperature: 0,
    });
  });

  it("returns text, truncation and usage", async () => {
    const { llm } = gatewayClient(mockFetch(() => completion({ content: "hello", finish_reason: "length" })).fetch);
    const response = await llm.complete(REQUEST);
    expect(response).toMatchObject({
      ok: true,
      text: "hello",
      truncated: true,
      meta: { model: DEV_RUN_CONFIG.model, attempts: 1, usage: { prompt_tokens: 1000, completion_tokens: 500 } },
    });
  });

  it("runs concurrent complete() calls one at a time", async () => {
    const transport = mockFetch(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(completion()), 5)),
    );
    const { llm } = gatewayClient(transport.fetch);
    await Promise.all([llm.complete(REQUEST), llm.complete(REQUEST), llm.complete(REQUEST)]);
    expect(transport.sent).toHaveLength(3);
    expect(transport.maxInFlight).toBe(1);
  });
});

describe("OpenAiCompatibleLlmClient: cost", () => {
  it("reads the gateway cost through the fetch hook on a wrapped client", async () => {
    const { llm } = gatewayClient(
      mockFetch(() =>
        completion({
          headers: {
            "x-litellm-response-cost": "0.00042",
            "x-litellm-key-spend": "3.25",
            "x-litellm-key-max-budget": "15",
          },
        }),
      ).fetch,
    );
    const response = await llm.complete(REQUEST);
    expect(response.meta).toMatchObject({
      header_source: "fetch_hook",
      cost: { basis: "gateway_reported", usd: 0.00042 },
      key_spend: { spend_usd: 3.25, max_budget_usd: 15 },
    });
  });

  it("uses withResponse() on an unwrapped SDK client", async () => {
    const sdk = new OpenAI({
      apiKey: API_KEY,
      baseURL: "https://gateway.invalid/v1",
      maxRetries: 0,
      fetch: mockFetch(() => completion({ headers: { "x-litellm-response-cost": "0.0007" } })).fetch,
    });
    const llm = new OpenAiCompatibleLlmClient({ client: sdk });
    const response = await llm.complete(REQUEST);
    expect(response.meta).toMatchObject({
      header_source: "with_response",
      cost: { basis: "gateway_reported", usd: 0.0007 },
    });
  });

  it.each(["-0.5", "Infinity", "NaN", "abc", ""])(
    "falls back to an estimate when the cost header is %j",
    async (value) => {
      const { llm } = gatewayClient(
        mockFetch(() => completion({ headers: { "x-litellm-response-cost": value } })).fetch,
      );
      const response = await llm.complete(REQUEST);
      expect(response.meta.cost).toEqual({
        basis: "estimated",
        usd: expect.closeTo(0.00385, 12),
        input_usd_per_million_tokens: 1.1,
        output_usd_per_million_tokens: 5.5,
      });
    },
  );

  it("estimates from usage when the cost header is absent", async () => {
    const { llm } = gatewayClient(mockFetch(() => completion()).fetch);
    const response = await llm.complete(REQUEST);
    expect(response.meta.cost.basis).toBe("estimated");
    expect(response.meta.cost.basis).not.toBe("gateway_reported");
  });

  it("is unavailable when there is neither a cost header nor usage", async () => {
    const { llm } = gatewayClient(mockFetch(() => completion({ usage: null })).fetch);
    const response = await llm.complete(REQUEST);
    expect(response.ok).toBe(true);
    expect(response.meta.cost).toEqual({ basis: "unavailable" });
    expect(response.meta.usage).toBeUndefined();
  });
});

describe("OpenAiCompatibleLlmClient: retries", () => {
  it("retries rate limits, honouring Retry-After, and records every attempt", async () => {
    const transport = mockFetch(
      () => errorResponse(429, "slow down", { "retry-after": "2" }),
      () => errorResponse(429, "slow down", { "retry-after-ms": "1500" }),
      () => completion({ content: "ok" }),
    );
    const { llm, waits } = gatewayClient(transport.fetch);
    const response = await llm.complete(REQUEST);

    expect(response).toMatchObject({ ok: true, text: "ok", meta: { attempts: 3, retry_waits_ms: [2000, 1500] } });
    expect(waits).toEqual([2000, 1500]);
    // One HTTP request per counted attempt: the SDK added none of its own.
    expect(transport.sent).toHaveLength(3);
  });

  it("returns rate_limited once the retries are used up", async () => {
    const transport = mockFetch(() => errorResponse(429, "slow down"));
    const { llm, waits } = gatewayClient(transport.fetch);
    const response = await llm.complete(REQUEST);

    expect(LLM_MAX_RETRIES).toBe(2);
    expect(response.ok).toBe(false);
    expect(!response.ok && response.error).toMatchObject({ category: "rate_limited", status: 429 });
    expect(!response.ok && response.error.message).toContain("after 3 attempts");
    expect(response.meta.attempts).toBe(1 + LLM_MAX_RETRIES);
    expect(transport.sent).toHaveLength(1 + LLM_MAX_RETRIES);
    // No Retry-After: the default backoff applies.
    expect(waits).toEqual([1000, 2000]);
  });

  it("does not retry early when Retry-After asks for longer than allowed", async () => {
    const transport = mockFetch(() => errorResponse(429, "slow down", { "retry-after": "3600" }));
    const { llm, waits } = gatewayClient(transport.fetch);
    const response = await llm.complete(REQUEST);

    expect(!response.ok && response.error.category).toBe("rate_limited");
    expect(response.meta.attempts).toBe(1);
    expect(waits).toEqual([]);
    expect(transport.sent).toHaveLength(1);
  });

  it("stops when the wait would pass the call deadline", async () => {
    const transport = mockFetch(() => errorResponse(429, "slow down", { "retry-after": "2" }));
    const { llm, waits } = gatewayClient(transport.fetch, { policy: { call_deadline_ms: 1_500 } });
    const response = await llm.complete(REQUEST);

    expect(!response.ok && response.error.category).toBe("rate_limited");
    expect(response.meta.attempts).toBe(1);
    expect(waits).toEqual([]);
  });

  // Regression: the SDK rejects a fractional timeout ("timeout must be an
  // integer"), which a clipped attempt timeout can produce.
  it("clips the attempt timeout to whole milliseconds", async () => {
    let t = 0;
    const { llm } = gatewayClient(mockFetch(() => completion({ content: "ok" })).fetch, {
      policy: { call_deadline_ms: 40_000 },
      now: () => (t += 10_000.7),
    });
    const response = await llm.complete(REQUEST);
    expect(response).toMatchObject({ ok: true, text: "ok" });
  });

  it("does not retry other failures, and the SDK adds no hidden retries", async () => {
    const transport = mockFetch(() => errorResponse(503, "upstream down"));
    const { llm } = gatewayClient(transport.fetch);
    const response = await llm.complete(REQUEST);

    expect(!response.ok && response.error).toMatchObject({ category: "provider_unavailable", status: 503 });
    expect(transport.sent).toHaveLength(1);
  });

  it("reads Retry-After as seconds, milliseconds or an HTTP date", () => {
    const now = Date.parse("2026-10-11T10:00:00Z");
    expect(retryAfterMs(new Headers({ "retry-after": "3" }), now)).toBe(3000);
    expect(retryAfterMs(new Headers({ "retry-after-ms": "250", "retry-after": "3" }), now)).toBe(250);
    expect(retryAfterMs(new Headers({ "retry-after": "Sun, 11 Oct 2026 10:00:04 GMT" }), now)).toBe(4000);
    expect(retryAfterMs(new Headers({ "retry-after": "soon" }), now)).toBeUndefined();
    expect(retryAfterMs(new Headers({ "retry-after": "-5" }), now)).toBeUndefined();
    expect(retryAfterMs(undefined, now)).toBeUndefined();
  });
});

describe("OpenAiCompatibleLlmClient: error categories", () => {
  it("reports a timed-out attempt as timeout, without retrying", async () => {
    const transport = mockFetch(
      (_body, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { llm } = gatewayClient(transport.fetch, { timeoutMs: 20 });
    const response = await llm.complete(REQUEST);

    expect(!response.ok && response.error.category).toBe("timeout");
    expect(response.meta.attempts).toBe(1);
    expect(transport.sent).toHaveLength(1);
  });

  it.each([
    [401, "auth_failed"],
    [403, "auth_failed"],
    [400, "model_error"],
    [404, "model_error"],
    [500, "provider_unavailable"],
  ] as const)("maps HTTP %i to %s", async (status, category) => {
    const { llm } = gatewayClient(mockFetch(() => errorResponse(status, "nope")).fetch);
    const response = await llm.complete(REQUEST);
    expect(!response.ok && response.error).toMatchObject({ category, status });
    expect(response.meta.attempts).toBe(1);
  });

  it("does not label an auth failure as a rate limit", async () => {
    const { llm, waits } = gatewayClient(mockFetch(() => errorResponse(401, "invalid key")).fetch);
    const response = await llm.complete(REQUEST);
    expect(!response.ok && response.error.category).toBe("auth_failed");
    expect(waits).toEqual([]);
  });

  it("reports a 2xx response without completion text as malformed_response", async () => {
    const { llm } = gatewayClient(mockFetch(() => completion({ choices: [] })).fetch);
    const response = await llm.complete(REQUEST);
    expect(!response.ok && response.error.category).toBe("malformed_response");
  });

  it("reports a lost connection as provider_unavailable", async () => {
    const { llm } = gatewayClient(
      mockFetch(() => {
        throw new TypeError("fetch failed");
      }).fetch,
    );
    const response = await llm.complete(REQUEST);
    expect(!response.ok && response.error.category).toBe("provider_unavailable");
  });

  it("never exposes the API key or an Authorization header in errors", async () => {
    const { llm } = gatewayClient(
      mockFetch(() =>
        errorResponse(400, `Invalid key ${API_KEY}; header was Authorization: Bearer ${API_KEY}`),
      ).fetch,
    );
    const response = await llm.complete(REQUEST);
    expect(response.ok).toBe(false);
    expectNoSecrets(response);
  });

  it("redacts keys and bearer tokens in arbitrary text", () => {
    expect(redactSecrets("key=sk-abcdefghijkl and Bearer xyz.123", [])).toBe(
      "key=[redacted] and Bearer [redacted]",
    );
    expect(redactSecrets("my-custom-secret-value here", ["my-custom-secret-value"])).toBe("[redacted] here");
    expect(redactSecrets('{"api_key": "abc123"}')).toBe('{"api_key": "[redacted]"}');
  });
});

describe("baseline pipeline with the real client and a mocked gateway", () => {
  it("runs end to end with temperature 0, gateway costs and no duplicate LLM spans", async () => {
    const transport = mockFetch((body) =>
      completion({
        content: defaultFakeAssessment(body as unknown as LlmRequest),
        headers: { "x-litellm-response-cost": "0.001" },
      }),
    );
    const { llm } = gatewayClient(transport.fetch);
    const h = harness(DEV_RUN_CONFIG);
    const result = await runBaselinePipeline(OPEN_ICP, { ...h.deps, llm }, { config: DEV_RUN_CONFIG });

    expect(result.status).toBe("completed");
    expect(result.prospects.every((p) => p.assessment.status === "assessed")).toBe(true);
    expect(transport.sent).toHaveLength(10);
    expect(transport.sent.every((r) => r.body.temperature === 0 && r.body.model === DEV_RUN_CONFIG.model)).toBe(true);
    expect(result.usage.llm_cost).toMatchObject({
      gateway_reported_usd: expect.closeTo(0.01, 12),
      calls_by_basis: { gateway_reported: 10, estimated: 0, unavailable: 0 },
      complete: true,
    });
    expect(result.run.cost_usd_by_step.assess).toBeCloseTo(0.01, 12);

    // wrapOpenAI owns the LLM spans; the pipeline's own span is CHAIN and
    // carries neither the prompt nor the completion.
    const spans = flattenSpans(h.roots);
    expect(spans.some((s) => s.kind === "LLM")).toBe(false);
    const company = spans.find((s) => s.name === "assess_company")!;
    expect(company.kind).toBe("CHAIN");
    expect(company.input).toEqual({ company_id: 1001, enrichment_status: "enriched" });
    expect(company.attributes).not.toHaveProperty("llm.output");
    expect(company.attributes["llm.header_source"]).toBe("fetch_hook");
  });
});
