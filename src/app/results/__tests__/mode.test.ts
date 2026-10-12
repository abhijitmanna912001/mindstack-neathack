import { describe, expect, it } from "vitest";
import { LIVE_MODE_REASON, parseRequestedMode, SYNTHETIC_MODE, UNSUPPORTED_MODE_REASON } from "../_lib/mode";

describe("parseRequestedMode", () => {
  it("accepts an absent mode as synthetic", () => {
    expect(parseRequestedMode(undefined)).toEqual({ ok: true, mode: SYNTHETIC_MODE });
  });

  it("accepts exactly 'synthetic'", () => {
    expect(parseRequestedMode("synthetic")).toEqual({ ok: true, mode: "synthetic" });
  });

  it("rejects 'live' with the mode=live reason", () => {
    expect(parseRequestedMode("live")).toEqual({ ok: false, reason: LIVE_MODE_REASON });
    expect(LIVE_MODE_REASON).toBe(
      "Only synthetic mode is available on this page. The mode=live parameter does not start a live run.",
    );
  });

  it.each([
    ["crustdata", "crustdata"],
    ["invalid", "invalid"],
    ["an empty string", ""],
    ["a repeated parameter", ["synthetic", "live"]],
    ["a repeated live parameter", ["live", "live"]],
    ["a repeated synthetic parameter", ["synthetic", "synthetic"]],
    ["different casing", "Synthetic"],
    ["different casing of live", "Live"],
    ["padding", " synthetic "],
    ["null", null],
    ["a number", 1],
    ["an object", { mode: "synthetic" }],
  ])("rejects %s with the general reason, which does not mention mode=live", (_label, value) => {
    expect(parseRequestedMode(value)).toEqual({ ok: false, reason: UNSUPPORTED_MODE_REASON });
    expect(UNSUPPORTED_MODE_REASON).toBe(
      "Only synthetic mode is available on this page. The requested mode is not supported.",
    );
    expect(UNSUPPORTED_MODE_REASON).not.toContain("mode=live");
  });
});
