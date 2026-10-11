// Real LlmClient over the OpenAI SDK, for an OpenAI-compatible endpoint such
// as the LiteLLM gateway. Build it with createGatewayLlmClient() in
// gateway-client.ts; this module never reads the environment.
//
// One logical call = one complete(). Inside it, rate-limit responses get a
// bounded number of retries, one at a time, and every HTTP attempt is counted
// in the returned meta. The SDK's own retries are disabled per request.

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "openai";
import {
  completeUsage,
  parseNonNegativeNumber,
  readGatewayCost,
  readKeySpend,
  resolveLlmCost,
} from "./llm-cost";
import type {
  LlmCallMeta,
  LlmClient,
  LlmError,
  LlmHeaderSource,
  LlmRequest,
  LlmResponse,
} from "./llm";
import {
  LLM_CALL_DEADLINE_MS,
  LLM_MAX_RETRIES,
  LLM_MAX_RETRY_WAIT_MS,
  LLM_REQUEST_TIMEOUT_MS,
  LLM_RETRY_BACKOFF_MS,
} from "./llm-policy";

type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;

export interface LlmRetryPolicy {
  readonly max_retries: number;
  readonly backoff_ms: readonly number[];
  readonly max_retry_wait_ms: number;
  readonly call_deadline_ms: number;
  readonly request_timeout_ms: number;
}

export const DEFAULT_LLM_RETRY_POLICY: LlmRetryPolicy = {
  max_retries: LLM_MAX_RETRIES,
  backoff_ms: LLM_RETRY_BACKOFF_MS,
  max_retry_wait_ms: LLM_MAX_RETRY_WAIT_MS,
  call_deadline_ms: LLM_CALL_DEADLINE_MS,
  request_timeout_ms: LLM_REQUEST_TIMEOUT_MS,
};

// Holds the headers of the latest HTTP response seen by the SDK's fetch.
// Needed because wrapOpenAI returns a plain Promise from
// chat.completions.create(), so withResponse() is not available on a
// wrapped client. Safe because the adapter runs one request at a time.
export class ResponseHeaderRecorder {
  private latest: Headers | undefined;

  reset(): void {
    this.latest = undefined;
  }

  record(headers: Headers): void {
    this.latest = headers;
  }

  take(): Headers | undefined {
    const headers = this.latest;
    this.latest = undefined;
    return headers;
  }
}

const REDACTED = "[redacted]";

// Strips API keys and Authorization values from text that may reach logs,
// traces or the UI.
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join(REDACTED);
  }
  return out
    .replace(/\b(Bearer)\s+[^\s"',;]+/gi, `$1 ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, REDACTED)
    .replace(/((?:api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, `$1${REDACTED}`);
}

// Wait before a retry, from retry-after-ms, then retry-after (seconds or an
// HTTP date). Undefined when no usable value is sent.
export function retryAfterMs(headers: Headers | undefined, wall_now: number): number | undefined {
  const ms = parseNonNegativeNumber(headers?.get("retry-after-ms"));
  if (ms !== undefined) return ms;
  const raw = headers?.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = parseNonNegativeNumber(raw);
  if (seconds !== undefined) return seconds * 1000;
  // A rejected number (e.g. "-5") is not a date; Date.parse would accept it.
  if (/^[+-]?[\d.]/.test(raw)) return undefined;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - wall_now) : undefined;
}

export function classifyLlmError(err: unknown, redact: (text: string) => string): LlmError {
  const message = redact(err instanceof Error ? err.message : String(err));
  if (err instanceof APIConnectionTimeoutError) return { category: "timeout", message };
  if (err instanceof APIConnectionError) return { category: "provider_unavailable", message };
  if (err instanceof APIError) {
    const status = typeof err.status === "number" ? err.status : undefined;
    const category =
      status === 429
        ? "rate_limited"
        : status === 401 || status === 403
          ? "auth_failed"
          : status === 408
            ? "timeout"
            : status !== undefined && status >= 500
              ? "provider_unavailable"
              : "model_error";
    return status !== undefined ? { category, message, status } : { category, message };
  }
  return { category: "model_error", message };
}

export interface OpenAiLlmClientOptions {
  readonly client: Pick<OpenAI, "chat">;
  // Required to read gateway headers from a wrapOpenAI client.
  readonly headers?: ResponseHeaderRecorder;
  // True when the client is wrapped with wrapOpenAI.
  readonly records_llm_spans?: boolean;
  readonly policy?: Partial<LlmRetryPolicy>;
  // Secrets to scrub from error messages, e.g. the API key.
  readonly secrets?: readonly string[];
  readonly sleep?: (ms: number) => Promise<void>;
  // Monotonic clock for the call deadline.
  readonly now?: () => number;
  // Wall clock for HTTP-date Retry-After values.
  readonly wall_clock?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class OpenAiCompatibleLlmClient implements LlmClient {
  readonly records_llm_spans: boolean;
  private readonly client: Pick<OpenAI, "chat">;
  private readonly headers: ResponseHeaderRecorder | undefined;
  private readonly policy: LlmRetryPolicy;
  private readonly secrets: readonly string[];
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly wall_clock: () => number;
  // Serialises calls so header capture and retries never overlap.
  private tail: Promise<unknown> = Promise.resolve();

  constructor(options: OpenAiLlmClientOptions) {
    this.client = options.client;
    this.headers = options.headers;
    this.records_llm_spans = options.records_llm_spans ?? false;
    this.policy = { ...DEFAULT_LLM_RETRY_POLICY, ...options.policy };
    this.secrets = options.secrets ?? [];
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? (() => performance.now());
    this.wall_clock = options.wall_clock ?? Date.now;
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    const result = this.tail.then(() => this.completeOnce(request));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private redact = (text: string): string => redactSecrets(text, this.secrets);

  private async completeOnce(request: LlmRequest): Promise<LlmResponse> {
    const started = this.now();
    const waits: number[] = [];
    let attempts = 0;

    for (;;) {
      // Whole milliseconds: the SDK rejects a fractional timeout.
      const remaining = Math.floor(this.policy.call_deadline_ms - (this.now() - started));
      if (remaining < 1) {
        return this.failure(request, attempts, waits, undefined, {
          category: "timeout",
          message: "The model call ran out of time before another attempt could start.",
        });
      }
      attempts += 1;
      let errorHeaders: Headers | undefined;
      try {
        const { completion, headers, header_source } = await this.send(
          request,
          Math.min(this.policy.request_timeout_ms, remaining),
        );
        return this.success(request, completion, headers, header_source, attempts, waits);
      } catch (err) {
        errorHeaders = err instanceof APIError ? err.headers : undefined;
        const error = classifyLlmError(err, this.redact);
        if (error.category !== "rate_limited") {
          return this.failure(request, attempts, waits, errorHeaders, error);
        }
        if (attempts > this.policy.max_retries) {
          return this.failure(request, attempts, waits, errorHeaders, {
            ...error,
            message: `Rate limited after ${attempts} attempts: ${error.message}`,
          });
        }
        const backoff =
          this.policy.backoff_ms[attempts - 1] ?? this.policy.backoff_ms.at(-1) ?? 0;
        const wait = retryAfterMs(errorHeaders, this.wall_clock()) ?? backoff;
        const elapsed = this.now() - started;
        if (wait > this.policy.max_retry_wait_ms || elapsed + wait >= this.policy.call_deadline_ms) {
          return this.failure(request, attempts, waits, errorHeaders, {
            ...error,
            message: `Rate limited; the required wait of ${Math.round(wait)} ms exceeds the retry limit, so no retry was made: ${error.message}`,
          });
        }
        waits.push(wait);
        await this.sleep(wait);
      }
    }
  }

  private async send(
    request: LlmRequest,
    timeout: number,
  ): Promise<{ completion: ChatCompletion; headers: Headers | undefined; header_source: LlmHeaderSource }> {
    this.headers?.reset();
    const pending = this.client.chat.completions.create(
      {
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        // max_tokens rather than max_completion_tokens: it is the parameter
        // OpenAI-compatible gateways accept most widely.
        max_tokens: request.max_output_tokens,
        temperature: request.temperature,
      },
      // No SDK retries, whatever the client was built with: ours are counted.
      { timeout, maxRetries: 0 },
    );
    // The SDK returns an APIPromise with withResponse(). wrapOpenAI returns a
    // plain Promise at runtime (its types still claim APIPromise), so fall
    // back to the headers the fetch hook recorded.
    if (typeof (pending as { withResponse?: unknown }).withResponse === "function") {
      const { data, response } = await pending.withResponse();
      return { completion: data, headers: response.headers, header_source: "with_response" };
    }
    const completion = await pending;
    const headers = this.headers?.take();
    return { completion, headers, header_source: headers ? "fetch_hook" : "none" };
  }

  private success(
    request: LlmRequest,
    completion: ChatCompletion,
    headers: Headers | undefined,
    header_source: LlmHeaderSource,
    attempts: number,
    waits: readonly number[],
  ): LlmResponse {
    const usage = completeUsage(
      completion?.usage?.prompt_tokens,
      completion?.usage?.completion_tokens,
    );
    const key_spend = readKeySpend(headers);
    const meta: LlmCallMeta = {
      model: request.model,
      attempts,
      retry_waits_ms: waits,
      ...(usage ? { usage } : {}),
      cost: resolveLlmCost(readGatewayCost(headers), usage),
      ...(key_spend ? { key_spend } : {}),
      header_source,
    };
    const choice = completion?.choices?.[0];
    const text = choice?.message?.content;
    if (typeof text !== "string") {
      return {
        ok: false,
        error: { category: "malformed_response", message: "The response has no completion text." },
        meta,
      };
    }
    return { ok: true, text, truncated: choice?.finish_reason === "length", meta };
  }

  private failure(
    request: LlmRequest,
    attempts: number,
    waits: readonly number[],
    headers: Headers | undefined,
    error: LlmError,
  ): LlmResponse {
    const key_spend = readKeySpend(headers);
    return {
      ok: false,
      error,
      meta: {
        model: request.model,
        attempts,
        retry_waits_ms: waits,
        cost: resolveLlmCost(readGatewayCost(headers), undefined),
        ...(key_spend ? { key_spend } : {}),
        header_source: headers ? "error_response" : "none",
      },
    };
  }
}
