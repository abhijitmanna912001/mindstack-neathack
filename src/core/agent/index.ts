// Public surface of the agent. The SDK-backed pieces are exported separately
// so importing the pipeline loads neither SDK: the neatlogs tracer from
// ./neatlogs-tracer, and the real model client from ./gateway-client
// (createGatewayLlmClient) and ./openai-llm.

export { runBaselinePipeline } from "./pipeline";
export { runImprovedPipeline } from "./improved-pipeline";
export { assessmentCriteria, buildSearchFilters, describeIcp } from "./icp";
export { BASELINE_SYSTEM_PROMPT, parseAssessment } from "./assess";

// PROMPT_VERSION identifies the shared prompt-safety rules
// that both pipelines' prompts import, not a complete pipeline-specific
// prompt. Bump it when those rules change. See prompt-rules.ts.
export { PROMPT_SAFETY_RULES, PROMPT_VERSION } from "./prompt-rules";

export { checkClaims, isCiteableFact, validateAssessment } from "./assessment-checks";
export { classifyCitations, computeBaselineCitationMetrics } from "./citation-metrics";

export {
  FACTS_SYSTEM_PROMPT,
  OVERALL_FIT_CRITERION,
  buildFactsMessages,
  expectedCriteria,
} from "./facts-prompt";

export type {
  FactsPromptData,
  FactsPromptFact,
  FactsPromptInput,
} from "./facts-prompt";

export {
  FakeLlmClient,
  defaultFakeAssessment,
  defaultFakeFactsAssessment,
} from "./fake-llm";
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
