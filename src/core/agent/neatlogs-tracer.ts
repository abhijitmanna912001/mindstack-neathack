// Adapts PipelineTracer to the neatlogs SDK. Entry points must call
// initTracing() from src/core/observability/tracing.ts first (and
// closeTracing() in scripts); without it neatlogs records nothing.

import { trace } from "neatlogs";
import type {
  PipelineSpan,
  PipelineTracer,
  TraceAttributes,
} from "./tracer";

type OtelSpan = Parameters<Parameters<typeof trace>[1]>[0];
type OtelAttributes = Parameters<OtelSpan["setAttributes"]>[0];

// OpenTelemetry attribute arrays are mutable; copy readonly arrays.
function toOtelAttributes(attributes: TraceAttributes): OtelAttributes {
  const out: OtelAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = [...value] as string[] | number[];
    }
  }
  return out;
}

export const neatlogsTracer: PipelineTracer = {
  span(options, fn) {
    return trace(
      { name: options.name, kind: options.kind, input: options.input },
      async (otelSpan) => {
        const span: PipelineSpan = {
          setAttributes: (attributes) =>
            otelSpan.setAttributes(toOtelAttributes(attributes)),
          addEvent: (name, attributes) =>
            otelSpan.addEvent(
              name,
              attributes ? toOtelAttributes(attributes) : undefined,
            ),
        };
        if (options.attributes) span.setAttributes(options.attributes);
        return fn(span);
      },
    );
  },
};
