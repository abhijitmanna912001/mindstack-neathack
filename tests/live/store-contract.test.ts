import { beforeEach, describe, expect, it } from "vitest";
import type { LiveStore, RunOutcome } from "../../src/server/live/store";
import { FakeLiveStore } from "./fake-live-store";

const T0 = new Date("2026-01-01T00:00:00Z");
const after = (s: number) => new Date(T0.getTime() + s * 1000);
const OUTCOME: RunOutcome = {
  status: "completed",
  searched: 10,
  enriched: 4,
  providerCostUsd: 0.12,
  modelCostUsd: 0.034,
};

function contract(name: string, make: () => LiveStore) {
  describe(`LiveStore contract: ${name}`, () => {
    let store: LiveStore;
    beforeEach(async () => {
      store = make();
      await store.admin.createCode("alice", 2, "hash-a");
      await store.admin.createCode("bob", 0, "hash-b");
    });

    it("has the kill switch OFF by default and toggles", async () => {
      expect(await store.isLiveEnabled()).toBe(false);
      await store.setLiveEnabled(true);
      expect(await store.isLiveEnabled()).toBe(true);
      await store.setLiveEnabled(false);
      expect(await store.isLiveEnabled()).toBe(false);
    });

    it("rejects unknown codes", async () => {
      expect(await store.reserveRun("nope", T0, 60)).toEqual({
        ok: false,
        reason: "invalid_code",
      });
    });

    it("reserves a run and reports runs remaining", async () => {
      const r = await store.reserveRun("hash-a", T0, 60);
      expect(r).toMatchObject({ ok: true, runsRemaining: 1 });
    });

    it("locks the code while a run is in progress", async () => {
      await store.reserveRun("hash-a", T0, 60);
      expect(await store.reserveRun("hash-a", after(5), 60)).toEqual({
        ok: false,
        reason: "run_in_progress",
      });
    });

    it("lets the lock expire", async () => {
      await store.reserveRun("hash-a", T0, 60);
      expect((await store.reserveRun("hash-a", after(61), 60)).ok).toBe(true);
    });

    it("unlocks after finishRun and then runs out", async () => {
      const r = await store.reserveRun("hash-a", T0, 60);
      if (!r.ok) throw new Error("expected ok");
      await store.finishRun(r.runId, OUTCOME);
      const second = await store.reserveRun("hash-a", after(1), 60);
      expect(second).toMatchObject({ ok: true, runsRemaining: 0 });
      if (!second.ok) throw new Error("expected ok");
      await store.finishRun(second.runId, { ...OUTCOME, status: "failed", errorCategory: "provider" });
      expect(await store.reserveRun("hash-a", after(2), 60)).toEqual({
        ok: false,
        reason: "no_runs_left",
      });
    });

    it("gives the run back on releaseRun", async () => {
      const r = await store.reserveRun("hash-a", T0, 60);
      if (!r.ok) throw new Error("expected ok");
      await store.releaseRun(r.runId);
      expect(await store.reserveRun("hash-a", after(1), 60)).toMatchObject({
        ok: true,
        runsRemaining: 1,
      });
    });

    it("ignores a second finish or release of the same run", async () => {
      const r = await store.reserveRun("hash-a", T0, 60);
      if (!r.ok) throw new Error("expected ok");
      await store.finishRun(r.runId, OUTCOME);
      await store.releaseRun(r.runId);
      const next = await store.reserveRun("hash-a", after(1), 60);
      expect(next).toMatchObject({ ok: true, runsRemaining: 0 });
    });

    it("reports no_runs_left for a zero-run code", async () => {
      expect(await store.reserveRun("hash-b", T0, 60)).toEqual({
        ok: false,
        reason: "no_runs_left",
      });
    });

    it("honours disable and enable", async () => {
      expect(await store.admin.disableCode("alice")).toBe(true);
      expect(await store.reserveRun("hash-a", T0, 60)).toEqual({
        ok: false,
        reason: "disabled",
      });
      await store.admin.enableCode("alice");
      expect((await store.reserveRun("hash-a", T0, 60)).ok).toBe(true);
    });

    it("adds runs and reports unknown labels", async () => {
      expect(await store.admin.addRuns("bob", 3)).toBe(true);
      expect((await store.reserveRun("hash-b", T0, 60)).ok).toBe(true);
      expect(await store.admin.addRuns("ghost", 1)).toBe(false);
      expect(await store.admin.disableCode("ghost")).toBe(false);
    });

    it("refuses duplicate labels and lists without hashes", async () => {
      expect(await store.admin.createCode("alice", 9, "hash-z")).toBe(false);
      const list = await store.admin.listCodes();
      expect(list).toEqual([
        { label: "alice", maxRuns: 2, runsUsed: 0, disabled: false },
        { label: "bob", maxRuns: 0, runsUsed: 0, disabled: false },
      ]);
      expect(JSON.stringify(list)).not.toContain("hash-");
    });

    it("counts hits in fixed windows", async () => {
      const a = await store.hit("ip:1", T0, 60, 2);
      const b = await store.hit("ip:1", after(10), 60, 2);
      const c = await store.hit("ip:1", after(20), 60, 2);
      expect([a.allowed, b.allowed, c.allowed]).toEqual([true, true, false]);
      expect(c.retryAfterSeconds).toBe(40);
      expect((await store.hit("ip:1", after(60), 60, 2)).allowed).toBe(true);
      expect((await store.hit("ip:2", after(20), 60, 2)).allowed).toBe(true);
    });
  });
}

contract("FakeLiveStore", () => new FakeLiveStore());
