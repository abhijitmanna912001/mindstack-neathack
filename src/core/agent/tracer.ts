// Tracing seam for the agent pipeline. The pipeline only talks to this
// interface; neatlogs-tracer.ts adapts it to the neatlogs SDK and tests use an
// in-memory recorder. Plain TypeScript only.

// Span kinds the pipeline uses. Each is a valid neatlogs trace() kind.
export type PipelineSpanKind = "WORKFLOW" | "CHAIN" | "TOOL" | "AGENT" | "LLM" | "GUARDRAIL";

export type TraceAttributeValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly number[];

export type TraceAttributes = Readonly<Record<string, TraceAttributeValue>>;

export interface PipelineSpan {
  setAttributes(attributes: TraceAttributes): void;
  addEvent(name: string, attributes?: TraceAttributes): void;
}

export interface PipelineSpanOptions {
  readonly name: string;
  readonly kind: PipelineSpanKind;
  // Captured as the span input. Keep it serialisable.
  readonly input?: unknown;
  readonly attributes?: TraceAttributes;
}

export interface PipelineTracer {
  span<T>(
    options: PipelineSpanOptions,
    fn: (span: PipelineSpan) => Promise<T>,
  ): Promise<T>;
}

const NOOP_SPAN: PipelineSpan = {
  setAttributes() {},
  addEvent() {},
};

export const noopTracer: PipelineTracer = {
  span: (_options, fn) => fn(NOOP_SPAN),
};
