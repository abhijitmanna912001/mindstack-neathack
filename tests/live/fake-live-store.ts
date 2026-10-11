// In-memory LiveStore used by the contract suite (no database).

import type {
  CodeMode,
  CodeSummary,
  HitResult,
  LiveStore,
  ReserveResult,
  RunOutcome,
} from "../../src/server/live/store";

interface Code {
  id: string;
  hash: string;
  label: string;
  maxRuns: number;
  runsUsed: number;
  disabled: boolean;
  mode: CodeMode;
  lockedUntil: number | null;
}
interface Run {
  codeId: string;
  status: string;
  outcome?: RunOutcome;
}

export class FakeLiveStore implements LiveStore {
  private enabled = false;
  private codes: Code[] = [];
  readonly runs = new Map<string, Run>();
  private hits = new Map<string, number>();
  private seq = 0;

  async isLiveEnabled() {
    return this.enabled;
  }
  async setLiveEnabled(value: boolean) {
    this.enabled = value;
  }

  async reserveRun(
    codeHash: string,
    now: Date,
    lockSeconds: number,
  ): Promise<ReserveResult> {
    const c = this.codes.find((x) => x.hash === codeHash);
    if (!c) return { ok: false, reason: "invalid_code" };
    if (c.disabled) return { ok: false, reason: "disabled" };
    if (c.runsUsed >= c.maxRuns) return { ok: false, reason: "no_runs_left" };
    if (c.lockedUntil !== null && c.lockedUntil > now.getTime()) {
      return { ok: false, reason: "run_in_progress" };
    }
    c.runsUsed += 1;
    c.lockedUntil = now.getTime() + lockSeconds * 1000;
    const runId = `run-${++this.seq}`;
    this.runs.set(runId, { codeId: c.id, status: "started" });
    return { ok: true, runId, runsRemaining: c.maxRuns - c.runsUsed, mode: c.mode };
  }

  async finishRun(runId: string, outcome: RunOutcome) {
    const r = this.runs.get(runId);
    if (!r || r.status !== "started") return;
    r.status = outcome.status;
    r.outcome = outcome;
    this.codes.find((c) => c.id === r.codeId)!.lockedUntil = null;
  }

  async releaseRun(runId: string) {
    const r = this.runs.get(runId);
    if (!r || r.status !== "started") return;
    r.status = "released";
    const c = this.codes.find((x) => x.id === r.codeId)!;
    c.runsUsed = Math.max(c.runsUsed - 1, 0);
    c.lockedUntil = null;
  }

  async hit(
    bucket: string,
    now: Date,
    windowSeconds: number,
    limit: number,
  ): Promise<HitResult> {
    const w = windowSeconds * 1000;
    const start = Math.floor(now.getTime() / w) * w;
    const key = `${bucket}@${start}`;
    const count = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, count);
    if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(Math.ceil((start + w - now.getTime()) / 1000), 1),
    };
  }

  private byLabel(label: string) {
    return this.codes.find((c) => c.label === label);
  }

  readonly admin = {
    createCode: async (
      label: string,
      maxRuns: number,
      codeHash: string,
      mode: CodeMode = "synthetic",
    ) => {
      if (this.codes.some((c) => c.label === label || c.hash === codeHash)) {
        return false;
      }
      this.codes.push({
        id: `code-${this.codes.length + 1}`,
        hash: codeHash,
        label,
        maxRuns,
        runsUsed: 0,
        disabled: false,
        mode,
        lockedUntil: null,
      });
      return true;
    },
    listCodes: async (): Promise<CodeSummary[]> =>
      this.codes.map((c) => ({
        label: c.label,
        maxRuns: c.maxRuns,
        runsUsed: c.runsUsed,
        disabled: c.disabled,
        mode: c.mode,
      })),
    disableCode: async (label: string) => {
      const c = this.byLabel(label);
      if (c) c.disabled = true;
      return !!c;
    },
    enableCode: async (label: string) => {
      const c = this.byLabel(label);
      if (c) c.disabled = false;
      return !!c;
    },
    setMode: async (label: string, mode: CodeMode) => {
      const c = this.byLabel(label);
      if (c) c.mode = mode;
      return !!c;
    },
    addRuns: async (label: string, n: number) => {
      const c = this.byLabel(label);
      if (c) c.maxRuns += n;
      return !!c;
    },
  };
}
