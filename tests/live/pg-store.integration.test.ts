// Runs only against a real Postgres, and only when TEST_DATABASE_URL is set.
// Everything happens in a throwaway schema that is dropped afterwards.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectPgStore, type PgLiveStore } from "../../src/server/live/pg-store";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

// Remote managed databases are slow from some networks.
suite("PgLiveStore against real Postgres", { timeout: 120_000 }, () => {
  vi.setConfig({ hookTimeout: 120_000 });

  const schema = `live_it_${randomBytes(6).toString("hex")}`;
  let store: PgLiveStore;
  let close: () => Promise<void>;
  let drop: () => Promise<void>;
  let run: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
  const T0 = new Date("2026-01-01T00:00:00Z");

  beforeAll(async () => {
    const { Pool } = await import("pg");
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    drop = async () => {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    };
    const conn = await connectPgStore(url!, { searchPath: schema });
    store = conn.store;
    close = conn.close;
    const scoped = new Pool({
      connectionString: url,
      max: 1,
      options: `-c search_path=${schema}`,
    });
    run = (sql) => scoped.query(sql);
    const prevClose = close;
    close = async () => {
      await scoped.end();
      await prevClose();
    };
    // Applying the schema file is itself part of the test.
    await scoped.query(
      readFileSync(join(__dirname, "../../src/server/live/schema.sql"), "utf8"),
    );
    // And it must be idempotent.
    await scoped.query(
      readFileSync(join(__dirname, "../../src/server/live/schema.sql"), "utf8"),
    );
  });

  afterAll(async () => {
    await close?.();
    await drop?.();
  });

  it("applies the schema with live mode OFF by default", async () => {
    expect(await store.isLiveEnabled()).toBe(false);
    await store.setLiveEnabled(true);
    expect(await store.isLiveEnabled()).toBe(true);
  });

  it("lets exactly one of 20 parallel reserveRun calls through", async () => {
    expect(await store.admin.createCode("race", 5, "race-hash")).toBe(true);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.reserveRun("race-hash", T0, 300)),
    );
    const winners = results.filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok && r.reason === "run_in_progress"),
    ).toHaveLength(19);

    const w = winners[0];
    if (!w.ok) throw new Error("unreachable");
    expect(w.runsRemaining).toBe(4);

    await store.finishRun(w.runId, {
      status: "completed",
      searched: 5,
      enriched: 2,
      providerCostUsd: 0.1234,
      modelCostUsd: 0.0567,
    });
    const next = await store.reserveRun("race-hash", T0, 300);
    expect(next).toMatchObject({ ok: true, runsRemaining: 3 });
  });

  it("never lets runs_used exceed max_runs", async () => {
    await store.admin.createCode("cap", 3, "cap-hash");
    for (let i = 0; i < 8; i++) {
      const r = await store.reserveRun("cap-hash", T0, 60);
      if (r.ok) await store.finishRun(r.runId, {
        status: "failed",
        searched: 0,
        enriched: 0,
        providerCostUsd: 0,
        modelCostUsd: 0,
        errorCategory: "test",
      });
    }
    const { rows } = await run(
      "SELECT runs_used, max_runs FROM invite_codes WHERE label = 'cap'",
    );
    expect(rows[0]).toEqual({ runs_used: 3, max_runs: 3 });
    expect(await store.reserveRun("cap-hash", T0, 60)).toEqual({
      ok: false,
      reason: "no_runs_left",
    });
  });

  it("defaults to synthetic, returns mode on reserve, and set-mode works", async () => {
    await store.admin.createCode("modey", 3, "modey-hash");
    expect(await store.reserveRun("modey-hash", T0, 60)).toMatchObject({ ok: true, mode: "synthetic" });
    expect(await store.admin.setMode("modey", "live")).toBe(true);
    expect(await store.reserveRun("modey-hash", new Date(T0.getTime() + 61_000), 60))
      .toMatchObject({ ok: true, mode: "live" });
    await store.admin.createCode("livecode", 1, "livecode-hash", "live");
    const listed = await store.admin.listCodes();
    expect(listed.find((c) => c.label === "livecode")?.mode).toBe("live");
    await expect(run("UPDATE invite_codes SET mode = 'bogus' WHERE label = 'modey'")).rejects.toThrow();
  });

  it("gives a run back on releaseRun", async () => {
    await store.admin.createCode("rel", 1, "rel-hash");
    const r = await store.reserveRun("rel-hash", T0, 60);
    if (!r.ok) throw new Error("expected ok");
    await store.releaseRun(r.runId);
    expect(await store.reserveRun("rel-hash", T0, 60)).toMatchObject({ ok: true });
  });

  it("counts hits per fixed window", async () => {
    const out = [];
    for (let i = 0; i < 4; i++) out.push(await store.hit("b", T0, 60, 3));
    expect(out.map((o) => o.allowed)).toEqual([true, true, true, false]);
    const later = new Date(T0.getTime() + 61_000);
    expect((await store.hit("b", later, 60, 3)).allowed).toBe(true);
    const parallel = await Promise.all(
      Array.from({ length: 10 }, () => store.hit("p", T0, 60, 4)),
    );
    expect(parallel.filter((p) => p.allowed)).toHaveLength(4);
  });
});
