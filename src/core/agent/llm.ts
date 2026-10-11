// Model access for the agent. The pipeline only talks to LlmClient; the real
// adapter lives in openai-llm.ts (built by gateway-client.ts) and tests use
// fake-llm.ts. Like providers, clients return errors instead of throwing.

import type { LlmCost, LlmKeySpend, LlmTokenUsage } from "./llm-cost";

export interface LlmMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface LlmRequest {
  // Always RunConfig.model; never hardcoded by a client.
  readonly model: string;
  readonly messages: readonly LlmMessage[];
  // Always RunConfig.max_output_tokens_per_call.
  readonly max_output_tokens: number;
  // Always LLM_TEMPERATURE (0).
  readonly temperature: number;
}

// Why a model call failed.
export type LlmErrorCategory =
  | "rate_limited" // 429, after any allowed retries
  | "timeout" // an attempt timed out, or the call ran out of time
  | "auth_failed" // 401 / 403
  | "provider_unavailable" // 5xx or no connection
  | "malformed_response" // a 2xx response without a usable completion
  | "model_error"; // anything else, e.g. 400 / 404 / 422

// Where the response headers were read from: withResponse() on an unwrapped
// SDK promise, the fetch hook (needed once wrapOpenAI has wrapped the
// client), the SDK error of a failed request, or nowhere.
export type LlmHeaderSource = "with_response" | "fetch_hook" | "error_response" | "none";

// Facts about one logical model call, success or failure. Secrets never
// appear here.
export interface LlmCallMeta {
  readonly model: string;
  // HTTP requests made for this logical call: 1 plus retries.
  readonly attempts: number;
  // Milliseconds waited before each retry.
  readonly retry_waits_ms: readonly number[];
  // Absent when the response did not report both token counts.
  readonly usage?: LlmTokenUsage;
  readonly cost: LlmCost;
  readonly key_spend?: LlmKeySpend;
  readonly header_source: LlmHeaderSource;
}

export interface LlmError {
  readonly category: LlmErrorCategory;
  // Redacted: never contains an API key or Authorization header.
  readonly message: string;
  readonly status?: number;
}

export type LlmResponse =
  | {
      readonly ok: true;
      readonly text: string;
      // True when the model stopped because it hit max_output_tokens.
      readonly truncated: boolean;
      readonly meta: LlmCallMeta;
    }
  | { readonly ok: false; readonly error: LlmError; readonly meta: LlmCallMeta };

export interface LlmClient {
  // True when the client records its own LLM spans (e.g. via wrapOpenAI), so
  // the pipeline must not record the prompt and completion a second time.
  readonly records_llm_spans: boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
