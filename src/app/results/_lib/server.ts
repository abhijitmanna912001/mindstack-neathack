// Server-only entry points for the results page. The official evidence
// summary is imported as a JSON module, so it is bundled with the server code
// at build time: no filesystem read at request time, and the file itself is
// never sent to the browser. Only the validated summary is rendered.

import "server-only";
import evidenceSummary from "../../../../evidence/summary.json";
import { type EvidenceState, parseEvidenceSummary } from "./evidence";
import { loadSyntheticResults, type SyntheticResults } from "./synthetic-run";

export function loadResults(requestedMode: unknown): Promise<SyntheticResults> {
  return loadSyntheticResults(requestedMode);
}

export function loadEvidence(): EvidenceState {
  return parseEvidenceSummary(evidenceSummary as unknown);
}
