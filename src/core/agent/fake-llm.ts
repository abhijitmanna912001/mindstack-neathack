// Deterministic LlmClient for tests and synthetic demos. No network. By
// default it answers every request with a well-formed assessment for the
// company named in the prompt. Costs go through the same resolveLlmCost()
// as the real adapter, so the labels match.

import {
  type LlmKeySpend,
  type LlmTokenUsage,
  resolveLlmCost,
} from "./llm-cost";
import type {
  LlmCallMeta,
  LlmClient,
  LlmErrorCategory,
  LlmRequest,
  LlmResponse,
} from "./llm";

export type FakeLlmReply =
  | string
  | {
      readonly text: string;
      // Defaults to 100 prompt / 50 completion tokens; null means the
      // response reported no usage.
      readonly usage?: LlmTokenUsage | null;
      readonly truncated?: boolean;
      // Simulates an x-litellm-response-cost header.
      readonly gateway_cost_usd?: number;
      readonly key_spend?: LlmKeySpend;
      readonly attempts?: number;
    }
  | {
      readonly error: string;
      readonly category?: LlmErrorCategory;
      readonly attempts?: number;
    };

// call_number is 1-based.
export type FakeLlmResponder = (
  request: LlmRequest,
  call_number: number,
) => FakeLlmReply;

export interface FakeLlmClientOptions {
  readonly respond?: FakeLlmResponder;
  // Simulated latency per call, to let tests observe overlapping calls.
  readonly delay_ms?: number;
  readonly records_llm_spans?: boolean;
}

const DEFAULT_USAGE: LlmTokenUsage = { prompt_tokens: 100, completion_tokens: 50 };

export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  readonly records_llm_spans: boolean;
  private readonly respond: FakeLlmResponder;
  private readonly delay_ms: number;
  private in_flight = 0;
  private max_in_flight_seen = 0;

  constructor(options: FakeLlmClientOptions = {}) {
    this.respond = options.respond ?? defaultFakeAssessment;
    this.delay_ms = options.delay_ms ?? 0;
    this.records_llm_spans = options.records_llm_spans ?? false;
  }

  // Most calls that were ever running at the same time.
  get max_in_flight(): number {
    return this.max_in_flight_seen;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const call_number = this.requests.length;
    this.in_flight += 1;
    this.max_in_flight_seen = Math.max(this.max_in_flight_seen, this.in_flight);
    try {
      if (this.delay_ms > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delay_ms));
      }
      const reply = this.respond(request, call_number);
      const base = { model: request.model, retry_waits_ms: [], header_source: "none" } as const;
      if (typeof reply === "string") {
        return {
          ok: true,
          text: reply,
          truncated: false,
          meta: { ...base, attempts: 1, usage: DEFAULT_USAGE, cost: resolveLlmCost(undefined, DEFAULT_USAGE) },
        };
      }
      if ("error" in reply) {
        return {
          ok: false,
          error: { category: reply.category ?? "model_error", message: reply.error },
          meta: { ...base, attempts: reply.attempts ?? 1, cost: { basis: "unavailable" } },
        };
      }
      const usage = reply.usage === null ? undefined : (reply.usage ?? DEFAULT_USAGE);
      const meta: LlmCallMeta = {
        ...base,
        attempts: reply.attempts ?? 1,
        ...(usage ? { usage } : {}),
        cost: resolveLlmCost(reply.gateway_cost_usd, usage),
        ...(reply.key_spend ? { key_spend: reply.key_spend } : {}),
      };
      return { ok: true, text: reply.text, truncated: reply.truncated ?? false, meta };
    } finally {
      this.in_flight -= 1;
    }
  }
}

// Reads the company id from the prompt's JSON record and returns a stable
// assessment for it.
export function defaultFakeAssessment(request: LlmRequest): string {
  const prompt = request.messages.map((m) => m.content).join("\n");
  const id = Number(/"crustdata_company_id":\s*(\d+)/.exec(prompt)?.[1] ?? 0);
  return JSON.stringify({
    fit_score: 40 + (id % 50),
    criterion_scores: [
      { criterion: "Industry", score: 60 + (id % 40), fact_ids: [`${id}:industry`] },
    ],
    uncertainty_notes: ["Synthetic assessment from the fake model client."],
    outreach: {
      body: `Hello from SignalScout. We work with teams like yours (company ${id}).`,
      cited_fact_ids: [`${id}:name`],
    },
  });
}
