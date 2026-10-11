// Model-call policy constants for the agent. Reviewed values live here, not
// scattered through the adapter. None of these are spending limits: the
// per-run model spend cap and the shared-key spend threshold are not yet
// agreed and belong in the shared RunConfig.

// Shared LiteLLM gateway (OpenAI-compatible). Callers may override it.
export const LITELLM_GATEWAY_BASE_URL = "https://litellm.vision.aivar.app/v1";

// Every model request is deterministic-as-possible.
export const LLM_TEMPERATURE = 0;

// Per HTTP attempt. The OpenAI SDK default is 10 minutes.
export const LLM_REQUEST_TIMEOUT_MS = 30_000;

// Retries after the first attempt, for rate-limit responses only. The SDK's
// own retries are disabled (maxRetries: 0) so these are the only ones.
export const LLM_MAX_RETRIES = 2;

// Wait before retry n (1-based) when the gateway sends no usable Retry-After.
export const LLM_RETRY_BACKOFF_MS: readonly number[] = [1_000, 2_000];

// Longest single wait we will honour. A longer Retry-After ends the call as
// rate_limited instead of retrying early.
export const LLM_MAX_RETRY_WAIT_MS = 10_000;

// Wall-clock budget for one logical model call, including retries and waits.
// Each attempt's timeout is clipped to what is left of it.
export const LLM_CALL_DEADLINE_MS = 60_000;

// Rough fallback rates documented by Abhijit, used only when the gateway
// does not report a cost. Results are labelled "estimated", never measured.
export const ESTIMATED_INPUT_USD_PER_MILLION_TOKENS = 1.1;
export const ESTIMATED_OUTPUT_USD_PER_MILLION_TOKENS = 5.5;
