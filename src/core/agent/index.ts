// Public surface of the agent. The SDK-backed pieces are exported separately
// so importing the pipeline loads neither SDK: the neatlogs tracer from
// ./neatlogs-tracer, and the real model client from ./gateway-client
// (createGatewayLlmClient) and ./openai-llm.

export { runBaselinePipeline } from "./pipeline";
export { assessmentCriteria, buildSearchFilters, describeIcp } from "./icp";
export { parseAssessment } from "./assess";
export { FakeLlmClient, defaultFakeAssessment } from "./fake-llm";
export type { FakeLlmReply, FakeLlmResponder } from "./fake-llm";
export type {
  LlmCallMeta,
  LlmClient,
  LlmError,
  LlmErrorCategory,
  LlmHeaderSource,
  LlmMessage,
  LlmRequest,
  LlmResponse,
} from "./llm";
export {
  estimateCostUsd,
  parseNonNegativeNumber,
  readGatewayCost,
  readKeySpend,
  resolveLlmCost,
} from "./llm-cost";
export type { LlmCost, LlmCostBasis, LlmKeySpend, LlmTokenUsage } from "./llm-cost";
export * from "./llm-policy";
export { noopTracer } from "./tracer";
export type {
  PipelineSpan,
  PipelineSpanKind,
  PipelineSpanOptions,
  PipelineTracer,
  TraceAttributes,
} from "./tracer";
export type * from "./types";
