import { describe, expect, it } from "vitest";
import {
  recordSystemHashes,
  sha256Hex,
  shortHash,
  summarizeValidation,
} from "../scripts/run-metrics";
import type { Validation } from "../src/core/types";

const v = (status: Validation["status"], related?: number): Validation => ({
  status,
  issues:
    related === undefined
      ? []
      : [{ code: "duplicate_domain", field: "primary_domain", reason: "dup", related_company_id: related }],
});

describe("hashes", () => {
  it("uses the first 12 hex characters of sha256", () => {
    expect(shortHash("abc")).toBe(sha256Hex("abc").slice(0, 12));
    expect(shortHash("abc")).toBe("ba7816bf8f01");
  });

  it("records only distinct system-message hashes", () => {
    const set = new Set<string>();
    recordSystemHashes(
      [
        { role: "system", content: "rules" },
        { role: "user", content: "company data" },
      ],
      set,
    );
    recordSystemHashes([{ role: "system", content: "rules" }], set);
    expect([...set]).toEqual([shortHash("rules")]);
  });
});

describe("summarizeValidation", () => {
  it("counts statuses per stage and lists rejected ids", () => {
    const validations = [v("valid"), v("rejected", 1), v("flagged"), v("rejected", 1), v("rejected")];
    const prospects = [
      { company_id: 1, enriched: true, delivered: true },
      { company_id: 2, enriched: true, delivered: true },
      { company_id: 3, enriched: true, delivered: false },
      { company_id: 4, enriched: false, delivered: true },
      { company_id: 5, enriched: true, delivered: false },
    ];
    const out = summarizeValidation(validations, prospects);
    expect(out.searched).toEqual({ valid: 1, flagged: 1, rejected: 3 });
    expect(out.enriched).toEqual({ valid: 1, flagged: 1, rejected: 2 });
    expect(out.delivered).toEqual({ valid: 1, flagged: 0, rejected: 2 });
    expect(out.wasted_enrichments).toBe(2);
    expect(out.rejected_but_enriched_ids).toEqual([2, 5]);
    expect(out.rejected_but_delivered_ids).toEqual([2, 4]);
    expect(out.delivered_duplicate_groups).toBe(1);
  });

  it("handles an empty run and rejects mismatched lengths", () => {
    expect(summarizeValidation([], []).searched).toEqual({ valid: 0, flagged: 0, rejected: 0 });
    expect(() => summarizeValidation([v("valid")], [])).toThrow();
  });
});
