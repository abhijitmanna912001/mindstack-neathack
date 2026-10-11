// Storage contract for live mode. Callers must fail closed: any
// LiveStoreUnavailable means "do not run".

export class LiveStoreUnavailable extends Error {
  constructor() {
    // Deliberately generic: driver errors can echo connection details.
    super("live store unavailable");
    this.name = "LiveStoreUnavailable";
  }
}

export type ReserveFailure =
  | "invalid_code"
  | "disabled"
  | "no_runs_left"
  | "run_in_progress";

export type ReserveResult =
  | { ok: true; runId: string; runsRemaining: number }
  | { ok: false; reason: ReserveFailure };

export interface RunOutcome {
  status: "completed" | "failed" | "budget_exhausted";
  searched: number;
  enriched: number;
  providerCostUsd: number;
  modelCostUsd: number;
  errorCategory?: string;
}

export interface HitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Never carries a hash.
export interface CodeSummary {
  label: string;
  maxRuns: number;
  runsUsed: number;
  disabled: boolean;
}

export interface LiveAdmin {
  // false when the label (or hash) already exists.
  createCode(label: string, maxRuns: number, codeHash: string): Promise<boolean>;
  listCodes(): Promise<CodeSummary[]>;
  // The three below return false when no code has that label.
  disableCode(label: string): Promise<boolean>;
  enableCode(label: string): Promise<boolean>;
  addRuns(label: string, n: number): Promise<boolean>;
}

export interface LiveStore {
  isLiveEnabled(): Promise<boolean>;
  setLiveEnabled(value: boolean): Promise<void>;
  reserveRun(
    codeHash: string,
    now: Date,
    lockSeconds: number,
  ): Promise<ReserveResult>;
  finishRun(runId: string, outcome: RunOutcome): Promise<void>;
  // For a run that failed before any paid call: gives the run back.
  releaseRun(runId: string): Promise<void>;
  // Fixed-window counter.
  hit(
    bucket: string,
    now: Date,
    windowSeconds: number,
    limit: number,
  ): Promise<HitResult>;
  admin: LiveAdmin;
}
