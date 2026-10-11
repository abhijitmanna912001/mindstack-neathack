import { describe, expect, it } from "vitest";
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  buildRunIcp,
  exitCodeForError,
  exitCodeForStatus,
  parseRunArgs,
  recordSystemHashes,
  sha256Hex,
  shortHash,
  summarizeValidation,
  validateRunArgs,
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

describe("run flags", () => {
  const resolve = (argv: string[], env: Record<string, string | undefined> = {}) =>
    validateRunArgs(parseRunArgs(argv), env);
  const KEY = { CRUSTDATA_API_KEY: "k" };

  it("defaults to a traced fixture run with the open ICP", () => {
    const run = resolve(["--pipeline", "improved"]);
    expect(run).toMatchObject({ provider: "fixture", llm: "fake", tracing: true, label: "improved" });
    expect(buildRunIcp(run)).toEqual({
      industry: "",
      employee_count_ranges: [],
      locations: [],
      keywords: [],
      excluded_domains: [],
    });
  });

  it("allows --trace off for fixture runs", () => {
    expect(resolve(["--pipeline", "baseline", "--trace", "off"]).tracing).toBe(false);
  });

  it("builds the crustdata ICP from defaults and flags, with tracing off", () => {
    const run = resolve(["--pipeline", "baseline", "--provider", "crustdata", "--confirm-spend"], KEY);
    expect(run.tracing).toBe(false);
    expect(buildRunIcp(run)).toMatchObject({
      industry: "Staffing and Recruiting",
      employee_count_ranges: ["11-50", "51-200"],
      locations: ["India"],
    });
    const custom = resolve(
      ["--pipeline", "improved", "--provider", "crustdata", "--confirm-spend", "--industry", "Software", "--country", "Germany", "--sizes", "1-10, 10001+"],
      KEY,
    );
    expect(buildRunIcp(custom)).toMatchObject({
      industry: "Software",
      employee_count_ranges: ["1-10", "10001+"],
      locations: ["Germany"],
    });
  });

  const refused: [string, string[], Record<string, string | undefined>, RegExp][] = [
    ["no pipeline", [], {}, /--pipeline is required/],
    ["unknown pipeline", ["--pipeline", "other"], {}, /baseline or improved/],
    ["unknown flag", ["--pipeline", "baseline", "--nope"], {}, /Unknown argument/],
    ["missing value", ["--pipeline"], {}, /needs a value/],
    ["bad provider", ["--pipeline", "baseline", "--provider", "x"], {}, /fixture or crustdata/],
    ["bad trace value", ["--pipeline", "baseline", "--trace", "maybe"], {}, /on or off/],
    ["bad sizes", ["--pipeline", "baseline", "--provider", "crustdata", "--sizes", "big"], KEY, /--sizes/],
    ["trace on with crustdata", ["--pipeline", "baseline", "--provider", "crustdata", "--confirm-spend", "--trace", "on"], KEY, /--trace on cannot be used/],
    ["crustdata without confirm", ["--pipeline", "baseline", "--provider", "crustdata"], KEY, /--confirm-spend/],
    ["crustdata without key", ["--pipeline", "baseline", "--provider", "crustdata", "--confirm-spend"], {}, /CRUSTDATA_API_KEY is not set/],
    ["crustdata with blank key", ["--pipeline", "baseline", "--provider", "crustdata", "--confirm-spend"], { CRUSTDATA_API_KEY: "  " }, /CRUSTDATA_API_KEY is not set/],
    ["icp flags on fixture", ["--pipeline", "baseline", "--industry", "Software"], {}, /only to --provider crustdata/],
    ["real llm without confirm", ["--pipeline", "baseline", "--llm", "real"], { LITELLM_API_KEY: "k" }, /--confirm-spend/],
    ["real llm without key", ["--pipeline", "baseline", "--llm", "real", "--confirm-spend"], {}, /LITELLM_API_KEY is not set/],
  ];
  it.each(refused)("refuses: %s", (_name, argv, env, message) => {
    expect(() => resolve(argv, env)).toThrow(UsageError);
    expect(() => resolve(argv, env)).toThrow(message);
  });

  it("never puts environment values in error messages", () => {
    try {
      resolve(["--pipeline", "baseline", "--provider", "crustdata", "--trace", "on"], { CRUSTDATA_API_KEY: "secret-value" });
    } catch (err) {
      expect((err as Error).message).not.toContain("secret-value");
    }
  });

  it("maps errors and statuses to exit codes", () => {
    expect(exitCodeForError(new UsageError("x"))).toBe(EXIT_USAGE);
    expect(exitCodeForError(new Error("x"))).toBe(EXIT_FAILED);
    expect(exitCodeForStatus("completed")).toBe(EXIT_OK);
    expect(exitCodeForStatus("completed_empty")).toBe(EXIT_OK);
    expect(exitCodeForStatus("stopped")).toBe(EXIT_FAILED);
    expect(new Set([EXIT_OK, EXIT_FAILED, EXIT_USAGE]).size).toBe(3);
  });
});
