import { describe, expect, it } from "vitest";
import {
  completeUsage,
  estimateCostUsd,
  parseNonNegativeNumber,
  readGatewayCost,
  readKeySpend,
  resolveLlmCost,
} from "../../src/core/agent/llm-cost";
import {
  ESTIMATED_INPUT_USD_PER_MILLION_TOKENS,
  ESTIMATED_OUTPUT_USD_PER_MILLION_TOKENS,
} from "../../src/core/agent/llm-policy";

describe("parseNonNegativeNumber", () => {
  it.each([
    ["0.00042", 0.00042],
    ["0", 0],
    [" 1.5 ", 1.5],
    ["2e-4", 0.0002],
  ])("accepts %j", (text, expected) => {
    expect(parseNonNegativeNumber(text)).toBe(expected);
  });

  it.each(["-0.01", "Infinity", "-Infinity", "NaN", "abc", "", "   ", "1,5", "$0.10"])(
    "rejects %j",
    (text) => {
      expect(parseNonNegativeNumber(text)).toBeUndefined();
    },
  );

  it("rejects missing values", () => {
    expect(parseNonNegativeNumber(null)).toBeUndefined();
    expect(parseNonNegativeNumber(undefined)).toBeUndefined();
  });
});

describe("gateway headers", () => {
  it("reads x-litellm-response-cost", () => {
    expect(readGatewayCost(new Headers({ "x-litellm-response-cost": "0.0031" }))).toBe(0.0031);
    expect(readGatewayCost(new Headers({ "x-litellm-response-cost": "-1" }))).toBeUndefined();
    expect(readGatewayCost(undefined)).toBeUndefined();
  });

  it("reads key spend and max budget when present", () => {
    expect(
      readKeySpend(new Headers({ "x-litellm-key-spend": "4.2", "x-litellm-key-max-budget": "15" })),
    ).toEqual({ spend_usd: 4.2, max_budget_usd: 15 });
    expect(readKeySpend(new Headers({ "x-litellm-key-spend": "4.2" }))).toEqual({ spend_usd: 4.2 });
    expect(readKeySpend(new Headers({ "x-litellm-key-max-budget": "None" }))).toBeUndefined();
    expect(readKeySpend(new Headers())).toBeUndefined();
  });
});

describe("cost resolution", () => {
  it("uses the documented fallback rates", () => {
    expect(ESTIMATED_INPUT_USD_PER_MILLION_TOKENS).toBe(1.1);
    expect(ESTIMATED_OUTPUT_USD_PER_MILLION_TOKENS).toBe(5.5);
    expect(estimateCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 0 })).toBeCloseTo(1.1, 12);
    expect(estimateCostUsd({ prompt_tokens: 0, completion_tokens: 1_000_000 })).toBeCloseTo(5.5, 12);
    expect(estimateCostUsd({ prompt_tokens: 1000, completion_tokens: 500 })).toBeCloseTo(0.00385, 12);
  });

  it("prefers the gateway cost and labels it gateway_reported", () => {
    expect(resolveLlmCost(0.002, { prompt_tokens: 1000, completion_tokens: 500 })).toEqual({
      basis: "gateway_reported",
      usd: 0.002,
    });
  });

  it("labels the token fallback estimated, with its rates", () => {
    expect(resolveLlmCost(undefined, { prompt_tokens: 1000, completion_tokens: 500 })).toEqual({
      basis: "estimated",
      usd: expect.closeTo(0.00385, 12),
      input_usd_per_million_tokens: 1.1,
      output_usd_per_million_tokens: 5.5,
    });
  });

  it("is unavailable, with no amount, when neither source exists", () => {
    const cost = resolveLlmCost(undefined, undefined);
    expect(cost).toEqual({ basis: "unavailable" });
    expect(cost).not.toHaveProperty("usd");
  });

  it("needs both token counts for an estimate", () => {
    expect(completeUsage(100, undefined)).toBeUndefined();
    expect(completeUsage(undefined, 50)).toBeUndefined();
    expect(completeUsage(-1, 50)).toBeUndefined();
    expect(completeUsage(100, 50)).toEqual({ prompt_tokens: 100, completion_tokens: 50 });
  });
});
