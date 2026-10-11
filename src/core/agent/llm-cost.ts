// Model cost accounting. A cost is either reported by the LiteLLM gateway,
// estimated from token usage at the fallback rates, or unavailable. A missing
// cost is never reported as $0.

import {
  ESTIMATED_INPUT_USD_PER_MILLION_TOKENS,
  ESTIMATED_OUTPUT_USD_PER_MILLION_TOKENS,
} from "./llm-policy";

export type LlmCost =
  | { readonly basis: "gateway_reported"; readonly usd: number }
  | {
      readonly basis: "estimated";
      readonly usd: number;
      readonly input_usd_per_million_tokens: number;
      readonly output_usd_per_million_tokens: number;
    }
  | { readonly basis: "unavailable" };

export type LlmCostBasis = LlmCost["basis"];

export interface LlmTokenUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
}

// Spend reported by the gateway for the shared API key, when it sends it.
export interface LlmKeySpend {
  readonly spend_usd?: number;
  readonly max_budget_usd?: number;
}

export const LITELLM_RESPONSE_COST_HEADER = "x-litellm-response-cost";
export const LITELLM_KEY_SPEND_HEADER = "x-litellm-key-spend";
export const LITELLM_KEY_MAX_BUDGET_HEADER = "x-litellm-key-max-budget";

// A header value as a finite, non-negative number, else undefined.
export function parseNonNegativeNumber(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const text = value.trim();
  if (text === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function readGatewayCost(headers: Headers | undefined): number | undefined {
  return parseNonNegativeNumber(headers?.get(LITELLM_RESPONSE_COST_HEADER));
}

export function readKeySpend(headers: Headers | undefined): LlmKeySpend | undefined {
  const spend_usd = parseNonNegativeNumber(headers?.get(LITELLM_KEY_SPEND_HEADER));
  const max_budget_usd = parseNonNegativeNumber(headers?.get(LITELLM_KEY_MAX_BUDGET_HEADER));
  if (spend_usd === undefined && max_budget_usd === undefined) return undefined;
  return {
    ...(spend_usd !== undefined ? { spend_usd } : {}),
    ...(max_budget_usd !== undefined ? { max_budget_usd } : {}),
  };
}

function isTokenCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

// Token usage only when both counts are present and sane.
export function completeUsage(
  prompt_tokens: unknown,
  completion_tokens: unknown,
): LlmTokenUsage | undefined {
  return isTokenCount(prompt_tokens) && isTokenCount(completion_tokens)
    ? { prompt_tokens, completion_tokens }
    : undefined;
}

export function estimateCostUsd(usage: LlmTokenUsage): number {
  return (
    (usage.prompt_tokens / 1_000_000) * ESTIMATED_INPUT_USD_PER_MILLION_TOKENS +
    (usage.completion_tokens / 1_000_000) * ESTIMATED_OUTPUT_USD_PER_MILLION_TOKENS
  );
}

// Gateway cost first, then an estimate from usage, else unavailable.
export function resolveLlmCost(
  gateway_cost_usd: number | undefined,
  usage: LlmTokenUsage | undefined,
): LlmCost {
  if (gateway_cost_usd !== undefined) {
    return { basis: "gateway_reported", usd: gateway_cost_usd };
  }
  if (usage) {
    return {
      basis: "estimated",
      usd: estimateCostUsd(usage),
      input_usd_per_million_tokens: ESTIMATED_INPUT_USD_PER_MILLION_TOKENS,
      output_usd_per_million_tokens: ESTIMATED_OUTPUT_USD_PER_MILLION_TOKENS,
    };
  }
  return { basis: "unavailable" };
}
