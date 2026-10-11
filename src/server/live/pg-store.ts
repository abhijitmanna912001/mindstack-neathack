// Postgres implementation of LiveStore over an injected minimal client, so
// tests need no driver. Every SQL string is a constant and parameterized.
// Any client failure becomes LiveStoreUnavailable (callers fail closed).

import {
  LiveStoreUnavailable,
  type CodeSummary,
  type HitResult,
  type LiveStore,
  type ReserveResult,
  type RunOutcome,
} from "./store";

export interface PgQueryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface PgDb extends PgQueryable {
  // Runs fn on one connection inside BEGIN/COMMIT (ROLLBACK on throw).
  transaction<T>(fn: (tx: PgQueryable) => Promise<T>): Promise<T>;
}

const SQL = {
  getSetting: "SELECT value FROM settings WHERE key = $1",
  setSetting:
    "INSERT INTO settings (key, value) VALUES ($1, $2) " +
    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
  reserve:
    "UPDATE invite_codes SET runs_used = runs_used + 1, " +
    "locked_until = $2::timestamptz + make_interval(secs => $3), " +
    "last_used_at = $2::timestamptz " +
    "WHERE code_hash = $1 AND NOT disabled AND runs_used < max_runs " +
    "AND (locked_until IS NULL OR locked_until <= $2::timestamptz) " +
    "RETURNING id, max_runs - runs_used AS remaining",
  reserveReason:
    "SELECT disabled, runs_used >= max_runs AS exhausted FROM invite_codes " +
    "WHERE code_hash = $1",
  insertRun:
    "INSERT INTO live_runs (invite_code_id, status, started_at) " +
    "VALUES ($1, 'started', $2::timestamptz) RETURNING id",
  finishRun:
    "UPDATE live_runs SET status = $2, finished_at = now(), searched = $3, " +
    "enriched = $4, provider_cost_usd = $5, model_cost_usd = $6, " +
    "error_category = $7 WHERE id = $1 AND status = 'started' " +
    "RETURNING invite_code_id",
  releaseRun:
    "UPDATE live_runs SET status = 'released', finished_at = now() " +
    "WHERE id = $1 AND status = 'started' RETURNING invite_code_id",
  unlock: "UPDATE invite_codes SET locked_until = NULL WHERE id = $1",
  giveBack:
    "UPDATE invite_codes SET runs_used = GREATEST(runs_used - 1, 0), " +
    "locked_until = NULL WHERE id = $1",
  hit:
    "INSERT INTO rate_hits (bucket, window_start, count) VALUES ($1, $2::timestamptz, 1) " +
    "ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_hits.count + 1 " +
    "RETURNING count",
  createCode:
    "INSERT INTO invite_codes (label, max_runs, code_hash) VALUES ($1, $2, $3) " +
    "ON CONFLICT DO NOTHING RETURNING id",
  listCodes:
    "SELECT label, max_runs, runs_used, disabled FROM invite_codes ORDER BY created_at, label",
  setDisabled:
    "UPDATE invite_codes SET disabled = $2 WHERE label = $1 RETURNING id",
  addRuns:
    "UPDATE invite_codes SET max_runs = max_runs + $2 WHERE label = $1 RETURNING id",
} as const;

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    throw new LiveStoreUnavailable();
  }
}

export class PgLiveStore implements LiveStore {
  constructor(private readonly db: PgDb) {}

  isLiveEnabled(): Promise<boolean> {
    return guard(async () => {
      const { rows } = await this.db.query(SQL.getSetting, ["live_enabled"]);
      return rows[0]?.value === "true";
    });
  }

  setLiveEnabled(value: boolean): Promise<void> {
    return guard(async () => {
      await this.db.query(SQL.setSetting, ["live_enabled", String(value)]);
    });
  }

  reserveRun(
    codeHash: string,
    now: Date,
    lockSeconds: number,
  ): Promise<ReserveResult> {
    return guard(() =>
      this.db.transaction(async (tx): Promise<ReserveResult> => {
        const iso = now.toISOString();
        const upd = await tx.query(SQL.reserve, [codeHash, iso, lockSeconds]);
        if (upd.rows.length === 0) {
          const { rows } = await tx.query(SQL.reserveReason, [codeHash]);
          const row = rows[0];
          if (!row) return { ok: false, reason: "invalid_code" };
          if (row.disabled) return { ok: false, reason: "disabled" };
          if (row.exhausted) return { ok: false, reason: "no_runs_left" };
          return { ok: false, reason: "run_in_progress" };
        }
        const { id, remaining } = upd.rows[0];
        const ins = await tx.query(SQL.insertRun, [id, iso]);
        return {
          ok: true,
          runId: String(ins.rows[0].id),
          runsRemaining: Number(remaining),
        };
      }),
    );
  }

  finishRun(runId: string, outcome: RunOutcome): Promise<void> {
    return guard(() =>
      this.db.transaction(async (tx) => {
        const { rows } = await tx.query(SQL.finishRun, [
          runId,
          outcome.status,
          outcome.searched,
          outcome.enriched,
          outcome.providerCostUsd,
          outcome.modelCostUsd,
          outcome.errorCategory ?? null,
        ]);
        if (rows[0]) await tx.query(SQL.unlock, [rows[0].invite_code_id]);
      }),
    );
  }

  releaseRun(runId: string): Promise<void> {
    return guard(() =>
      this.db.transaction(async (tx) => {
        const { rows } = await tx.query(SQL.releaseRun, [runId]);
        if (rows[0]) await tx.query(SQL.giveBack, [rows[0].invite_code_id]);
      }),
    );
  }

  hit(
    bucket: string,
    now: Date,
    windowSeconds: number,
    limit: number,
  ): Promise<HitResult> {
    return guard(async () => {
      const windowMs = windowSeconds * 1000;
      const start = Math.floor(now.getTime() / windowMs) * windowMs;
      const { rows } = await this.db.query(SQL.hit, [
        bucket,
        new Date(start).toISOString(),
      ]);
      const count = Number(rows[0].count);
      if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
      const retry = Math.ceil((start + windowMs - now.getTime()) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(retry, 1) };
    });
  }

  readonly admin: LiveStore["admin"] = {
    createCode: (label, maxRuns, codeHash) =>
      guard(async () => {
        const { rows } = await this.db.query(SQL.createCode, [
          label,
          maxRuns,
          codeHash,
        ]);
        return rows.length > 0;
      }),
    listCodes: () =>
      guard(async (): Promise<CodeSummary[]> => {
        const { rows } = await this.db.query(SQL.listCodes);
        return rows.map((r) => ({
          label: String(r.label),
          maxRuns: Number(r.max_runs),
          runsUsed: Number(r.runs_used),
          disabled: Boolean(r.disabled),
        }));
      }),
    disableCode: (label) =>
      guard(async () => {
        const { rows } = await this.db.query(SQL.setDisabled, [label, true]);
        return rows.length > 0;
      }),
    enableCode: (label) =>
      guard(async () => {
        const { rows } = await this.db.query(SQL.setDisabled, [label, false]);
        return rows.length > 0;
      }),
    addRuns: (label, n) =>
      guard(async () => {
        const { rows } = await this.db.query(SQL.addRuns, [label, n]);
        return rows.length > 0;
      }),
  };
}

// Real driver wiring. pg is imported lazily so unit tests never load it.
export async function connectPgStore(
  databaseUrl: string,
  options: { searchPath?: string } = {},
): Promise<{ store: PgLiveStore; close(): Promise<void> }> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: databaseUrl,
    ...(options.searchPath
      ? { options: `-c search_path=${options.searchPath}` }
      : {}),
  });
  const db: PgDb = {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: (t, p) => client.query(t, p) });
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
  return { store: new PgLiveStore(db), close: () => pool.end() };
}
