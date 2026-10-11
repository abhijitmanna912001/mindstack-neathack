// Builds the real model client: an OpenAI SDK client pointed at the LiteLLM
// gateway, instrumented with neatlogs' wrapOpenAI, inside the agent's retry
// and cost-accounting adapter.
//
// Everything is passed in explicitly: this module never reads process.env,
// never initialises or closes tracing (entry points call initTracing() /
// closeTracing() from src/core/observability/tracing.ts), and never puts the
// API key in an error message.

import { wrapOpenAI } from "neatlogs/openai";
import OpenAI from "openai";
import { LITELLM_GATEWAY_BASE_URL, LLM_REQUEST_TIMEOUT_MS } from "./llm-policy";
import {
  type LlmRetryPolicy,
  OpenAiCompatibleLlmClient,
  ResponseHeaderRecorder,
} from "./openai-llm";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GatewayClientOptions {
  // Supplied by the entry point. Never logged.
  readonly apiKey: string;
  // Defaults to the shared LiteLLM gateway.
  readonly baseURL?: string;
  // Per HTTP attempt. Defaults to LLM_REQUEST_TIMEOUT_MS (30 s).
  readonly timeoutMs?: number;
  // Transport override, for tests. Defaults to the global fetch.
  readonly fetch?: Fetch;
}

export interface GatewayLlmClientOptions extends GatewayClientOptions {
  readonly policy?: Partial<Omit<LlmRetryPolicy, "request_timeout_ms">>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly wall_clock?: () => number;
}

export interface GatewayClient {
  // The wrapOpenAI-instrumented SDK client.
  readonly client: OpenAI;
  // Response headers recorded by the client's fetch.
  readonly headers: ResponseHeaderRecorder;
}

export function createGatewayOpenAIClient(options: GatewayClientOptions): GatewayClient {
  if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
    throw new Error("The model gateway API key is missing.");
  }
  const headers = new ResponseHeaderRecorder();
  const baseFetch: Fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const recordingFetch: Fetch = async (input, init) => {
    const response = await baseFetch(input, init);
    headers.record(response.headers);
    return response;
  };
  const sdk = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL ?? LITELLM_GATEWAY_BASE_URL,
    timeout: options.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS,
    // Our adapter owns retries; the SDK default (2) would add hidden requests.
    maxRetries: 0,
    fetch: recordingFetch,
    // Explicit, so the SDK does not fall back to OPENAI_* environment values.
    organization: null,
    project: null,
    webhookSecret: null,
    logLevel: "warn",
  });
  return { client: wrapOpenAI(sdk), headers };
}

export function createGatewayLlmClient(options: GatewayLlmClientOptions): OpenAiCompatibleLlmClient {
  const { client, headers } = createGatewayOpenAIClient(options);
  return new OpenAiCompatibleLlmClient({
    client,
    headers,
    records_llm_spans: true,
    policy: {
      ...options.policy,
      request_timeout_ms: options.timeoutMs ?? LLM_REQUEST_TIMEOUT_MS,
    },
    secrets: [options.apiKey],
    sleep: options.sleep,
    now: options.now,
    wall_clock: options.wall_clock,
  });
}
