import { describe, expect, it } from "vitest";
import { parseRequestedMode, SYNTHETIC_MODE, UNSUPPORTED_MODE_REASON } from "../_lib/mode";

describe("parseRequestedMode", () => {
  it("accepts an absent mode as synthetic", () => {
    expect(parseRequestedMode(undefined)).toEqual({ ok: true, mode: SYNTHETIC_MODE });
  });

  it("accepts exactly 'synthetic'", () => {
    expect(parseRequestedMode("synthetic")).toEqual({ ok: true, mode: "synthetic" });
  });

  it.each([
    ["live", "live"],
    ["crustdata", "crustdata"],
    ["an empty string", ""],
    ["a repeated parameter", ["synthetic", "live"]],
    ["a repeated synthetic parameter", ["synthetic", "synthetic"]],
    ["different casing", "Synthetic"],
    ["padding", " synthetic "],
    ["null", null],
    ["a number", 1],
    ["an object", { mode: "synthetic" }],
  ])("rejects %s", (_label, value) => {
    expect(parseRequestedMode(value)).toEqual({ ok: false, reason: UNSUPPORTED_MODE_REASON });
  });
});
