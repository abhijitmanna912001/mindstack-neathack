// Deterministic fake-model responder for the synthetic guardrail
// demonstration. Every company gets the agent's own facts-based reply
// (defaultFakeFactsAssessment), except DEMO_UNSUPPORTED_NUMBER_COMPANY_ID,
// whose outreach adds a growth figure that none of its facts contain. The
// real improved pipeline then runs checkClaims() on it, which finds the
// unsupported number and suppresses the outreach. Nothing here creates a
// finding: the finding comes from the pipeline.

import { defaultFakeFactsAssessment, type FakeLlmResponder } from "../../../core/agent/fake-llm";
import { readFactsPrompt } from "../../../core/agent/facts-prompt";

export const DEMO_UNSUPPORTED_NUMBER_COMPANY_ID = 1001;

// The figure the synthetic model invents; no fixture fact states it.
export const DEMO_UNSUPPORTED_SENTENCE = "Congratulations on growing revenue 40% this year.";

export const guardrailDemoResponder: FakeLlmResponder = (request) => {
  const reply = defaultFakeFactsAssessment(request);
  const prompt = readFactsPrompt(request.messages);
  if (prompt?.data.company_id !== DEMO_UNSUPPORTED_NUMBER_COMPANY_ID) return reply;

  const assessment = JSON.parse(reply) as {
    outreach?: { body: string; cited_fact_ids: string[] };
  };
  if (!assessment.outreach) return reply;
  return JSON.stringify({
    ...assessment,
    outreach: {
      ...assessment.outreach,
      body: `${assessment.outreach.body} ${DEMO_UNSUPPORTED_SENTENCE}`,
    },
  });
};
