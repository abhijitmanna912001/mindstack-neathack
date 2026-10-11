import { describe, expect, it } from "vitest";
import { neatlogsTracer } from "../../src/core/agent/neatlogs-tracer";
import { runBaselinePipeline } from "../../src/core/agent/pipeline";
import { DEV_RUN_CONFIG } from "../../src/core/types";
import { OPEN_ICP, harness } from "./helpers";

// initTracing() is never called here, so neatlogs records and exports nothing.
// These tests only check that the adapter is a transparent wrapper.
describe("neatlogsTracer", () => {
  it("returns the wrapped function's result and accepts attributes and events", async () => {
    const result = await neatlogsTracer.span(
      { name: "unit", kind: "TOOL", input: { a: 1 }, attributes: { "x.list": ["a", "b"] } },
      async (span) => {
        span.setAttributes({ "x.count": 2, "x.flag": true, "x.ids": [1, 2] });
        span.addEvent("checkpoint", { "x.step": "one" });
        return 42;
      },
    );
    expect(result).toBe(42);
  });

  it("propagates errors from the wrapped function", async () => {
    await expect(
      neatlogsTracer.span({ name: "unit", kind: "CHAIN" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("can drive a full pipeline run", async () => {
    const h = harness(DEV_RUN_CONFIG);
    const result = await runBaselinePipeline(
      OPEN_ICP,
      { ...h.deps, tracer: neatlogsTracer },
      { config: DEV_RUN_CONFIG },
    );
    expect(result.status).toBe("completed");
    expect(result.prospects).toHaveLength(10);
  });
});
