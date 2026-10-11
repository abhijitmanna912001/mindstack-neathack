import { describe, expect, it } from "vitest";
import {
  PgLiveStore,
  type PgDb,
  type PgQueryable,
} from "../../src/server/live/pg-store";
import { LiveStoreUnavailable } from "../../src/server/live/store";

type Reply = { rows: unknown[] } | Error;

function fakeDb(replies: Reply[] = []) {
  const calls: { text: string; params: unknown[] | undefined }[] = [];
  const events: string[] = [];
  const q: PgQueryable = {
    async query(text, params) {
      calls.push({ text, params });
      const next = replies.shift() ?? { rows: [] };
      if (next instanceof Error) throw next;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return next as { rows: any[] };
    },
  };
  const db: PgDb = {
    query: q.query,
    async transaction(fn) {
      events.push("begin");
      try {
        const out = await fn(q);
        events.push("commit");
        return out;
      } catch (e) {
        events.push("rollback");
        throw e;
      }
    },
  };
  return { db, calls, events };
}

const NOW = new Date("2026-01-01T00:00:30Z");

describe("PgLiveStore.reserveRun", () => {
  it("issues one atomic UPDATE then an INSERT in a transaction", async () => {
    const { db, calls, events } = fakeDb([
      { rows: [{ id: "code-1", remaining: 4 }] },
      { rows: [{ id: "run-1" }] },
    ]);
    const r = await new PgLiveStore(db).reserveRun("HASH", NOW, 120);
    expect(r).toEqual({ ok: true, runId: "run-1", runsRemaining: 4 });
    expect(events).toEqual(["begin", "commit"]);
    expect(calls).toHaveLength(2);
    const upd = calls[0].text;
    expect(upd).toMatch(/^UPDATE invite_codes SET runs_used = runs_used \+ 1/);
    expect(upd).toContain("WHERE code_hash = $1 AND NOT disabled");
    expect(upd).toContain("runs_used < max_runs");
    expect(upd).toContain("locked_until IS NULL OR locked_until <=");
    expect(upd).toContain("RETURNING id, max_runs - runs_used AS remaining");
    expect(calls[0].params).toEqual(["HASH", NOW.toISOString(), 120]);
    expect(calls[1].text).toMatch(/^INSERT INTO live_runs/);
    expect(calls[1].params).toEqual(["code-1", NOW.toISOString()]);
  });

  it.each([
    [[], "invalid_code"],
    [[{ disabled: true, exhausted: false }], "disabled"],
    [[{ disabled: false, exhausted: true }], "no_runs_left"],
    [[{ disabled: false, exhausted: false }], "run_in_progress"],
  ])("picks the reason with a SELECT only: %j -> %s", async (rows, reason) => {
    const { db, calls } = fakeDb([{ rows: [] }, { rows }]);
    const r = await new PgLiveStore(db).reserveRun("HASH", NOW, 60);
    expect(r).toEqual({ ok: false, reason });
    expect(calls).toHaveLength(2);
    expect(calls[1].text).toMatch(/^SELECT/);
  });
});

describe("PgLiveStore.hit", () => {
  it("uses a single upsert and a fixed window", async () => {
    const { db, calls } = fakeDb([{ rows: [{ count: 3 }] }]);
    const r = await new PgLiveStore(db).hit("ip:x", NOW, 60, 2);
    expect(calls[0].text).toContain(
      "ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_hits.count + 1",
    );
    expect(calls[0].text).toContain("RETURNING count");
    expect(calls[0].params).toEqual(["ip:x", "2026-01-01T00:00:00.000Z"]);
    expect(r).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it("allows up to the limit", async () => {
    const { db } = fakeDb([{ rows: [{ count: 2 }] }]);
    expect(await new PgLiveStore(db).hit("b", NOW, 60, 2)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});

describe("PgLiveStore SQL hygiene", () => {
  it("parameterizes every statement and never interpolates inputs", async () => {
    const evil = "x'; DROP TABLE invite_codes; --";
    const { db, calls } = fakeDb([
      { rows: [{ value: "true" }] },
      { rows: [] },
      { rows: [{ id: "c", remaining: 1 }] },
      { rows: [{ id: "r" }] },
      { rows: [{ invite_code_id: "c" }] },
      { rows: [] },
      { rows: [{ invite_code_id: "c" }] },
      { rows: [] },
      { rows: [{ count: 1 }] },
      { rows: [{ id: "x" }] },
      { rows: [] },
      { rows: [{ id: "x" }] },
      { rows: [{ id: "x" }] },
      { rows: [{ id: "x" }] },
    ]);
    const s = new PgLiveStore(db);
    await s.isLiveEnabled();
    await s.setLiveEnabled(true);
    const r = await s.reserveRun(evil, NOW, 60);
    await s.finishRun("r", {
      status: "failed",
      searched: 1,
      enriched: 0,
      providerCostUsd: 0,
      modelCostUsd: 0,
      errorCategory: evil,
    });
    await s.releaseRun("r");
    await s.hit(evil, NOW, 60, 1);
    await s.admin.createCode(evil, 1, evil);
    await s.admin.listCodes();
    await s.admin.disableCode(evil);
    await s.admin.enableCode(evil);
    await s.admin.addRuns(evil, 1);
    expect(r.ok).toBe(true);
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) {
      expect(c.text).not.toContain("DROP");
      expect(c.text).not.toContain(evil);
      const nums = (c.text.match(/\$\d+/g) ?? []).map((p) => Number(p.slice(1)));
      expect(c.params?.length ?? 0).toBe(nums.length ? Math.max(...nums) : 0);
    }
  });

  it("does not read rows from settings absent as enabled", async () => {
    const { db } = fakeDb([{ rows: [] }]);
    expect(await new PgLiveStore(db).isLiveEnabled()).toBe(false);
  });
});

describe("PgLiveStore failure handling", () => {
  const boom = new Error("connect postgres://user:pw@host/db failed");

  it("turns any client error into LiveStoreUnavailable without the cause", async () => {
    const calls: Array<(s: PgLiveStore) => Promise<unknown>> = [
      (s) => s.isLiveEnabled(),
      (s) => s.setLiveEnabled(true),
      (s) => s.reserveRun("h", NOW, 1),
      (s) => s.finishRun("r", { status: "completed", searched: 0, enriched: 0, providerCostUsd: 0, modelCostUsd: 0 }),
      (s) => s.releaseRun("r"),
      (s) => s.hit("b", NOW, 1, 1),
      (s) => s.admin.createCode("l", 1, "h"),
      (s) => s.admin.listCodes(),
      (s) => s.admin.disableCode("l"),
      (s) => s.admin.enableCode("l"),
      (s) => s.admin.addRuns("l", 1),
    ];
    for (const call of calls) {
      const { db } = fakeDb([boom, boom, boom]);
      const err: unknown = await call(new PgLiveStore(db)).catch((e) => e);
      expect(err).toBeInstanceOf(LiveStoreUnavailable);
      expect((err as Error).message).not.toContain("postgres://");
      expect((err as { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it("rolls back when the INSERT after the UPDATE fails", async () => {
    const { db, events } = fakeDb([{ rows: [{ id: "c", remaining: 1 }] }, boom]);
    await expect(new PgLiveStore(db).reserveRun("h", NOW, 1)).rejects.toBeInstanceOf(
      LiveStoreUnavailable,
    );
    expect(events).toEqual(["begin", "rollback"]);
  });
});
