import { describe, expect, it } from "vitest";
import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  UsageError,
  buildRunIcp,
  exitCodeForError,
  exitCodeForStatus,
  formatOutreachLine,
  parseRunArgs,
  recordSystemHashes,
  sha256Hex,
  shortHash,
  summarizeFinalValidation,
  summarizeGuardFindings,
  summarizeOutreachKept,
  summarizeValidation,
  validateRunArgs,
} from "../scripts/run-metrics";
import type { BaselineProspect } from "../src/core/agent/types";
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

describe("summarizeFinalValidation", () => {
  const withIssues = (status: Validation["status"], ...pairs: [string, string][]): Validation => ({
    status,
    issues: pairs.map(([code, field]) => ({ code, field, reason: "secret reason" }) as Validation["issues"][number]),
  });

  it("counts statuses, issue pairs and enrichment-driven changes, ids only", () => {
    const search = [v("valid"), v("valid"), v("flagged"), v("rejected")];
    const final = [
      withIssues("flagged", ["size_headcount_mismatch", "revenue_range"]),
      v("valid"),
      withIssues("flagged", ["missing_linkedin", "professional_network_url"], ["size_headcount_mismatch", "revenue_range"]),
      withIssues("rejected", ["missing_name", "name"]),
    ];
    const prospects = [
      { company_id: 10, assessed: true },
      { company_id: 11, assessed: true },
      { company_id: 12, assessed: false },
      { company_id: 13, assessed: false },
    ];
    const out = summarizeFinalValidation(search, final, prospects);
    expect(out.all).toEqual({ valid: 1, flagged: 2, rejected: 1 });
    expect(out.assessed).toEqual({ valid: 1, flagged: 1, rejected: 0 });
    expect(out.issues_by_code_field).toEqual({
      "size_headcount_mismatch:revenue_range": 2,
      "missing_linkedin:professional_network_url": 1,
      "missing_name:name": 1,
    });
    expect(out.changed_by_enrichment).toEqual({
      count: 1,
      transitions: { "valid->flagged": 1 },
      company_ids: [10],
    });
    expect(JSON.stringify(out)).not.toContain("secret reason");
  });

  it("handles an empty run and rejects mismatched lengths", () => {
    expect(summarizeFinalValidation([], [], []).changed_by_enrichment.count).toBe(0);
    expect(() => summarizeFinalValidation([v("valid")], [], [])).toThrow();
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

describe("outreach and guard summaries", () => {
  const outreach = (ids: string[]) => ({ cited_fact_ids: ids });
  const prospect = (
    id: number,
    cited: string[] | null,
    extra: Partial<BaselineProspect> = {},
  ): BaselineProspect =>
    ({
      raw: { crustdata_company_id: id },
      enrichment: { status: "enriched" },
      assessment: {
        status: "assessed",
        assessment: cited === null ? {} : { outreach: outreach(cited) },
      },
      ...extra,
    }) as unknown as BaselineProspect;
  const failed = {
    raw: { crustdata_company_id: 9 },
    enrichment: { status: "enriched" },
    assessment: { status: "failed", reason: "llm_error", message: "x" },
  } as unknown as BaselineProspect;

  it("counts kept drafts and distinct cited ids, ids only", () => {
    const out = summarizeOutreachKept([
      prospect(1, ["1:a", "1:b", "1:a"]),
      prospect(2, null),
      failed,
      prospect(3, ["3:a"]),
    ]);
    expect(out).toEqual({ prospects: 2, cited_fact_ids: 3, company_ids: [1, 3] });
    expect(summarizeOutreachKept([])).toEqual({ prospects: 0, cited_fact_ids: 0, company_ids: [] });
  });

  it("tallies guard findings by code without messages", () => {
    const f = (code: string) => ({ code, severity: "error", message: "secret text" });
    const checks = (outreachDecision: string, a: string[], c?: string[]) => ({
      assessment: { ok: true, findings: a.map(f) },
      ...(c && { claims: { ok: false, findings: c.map(f) } }),
      outreach: outreachDecision,
    });
    const out = summarizeGuardFindings(
      [
        prospect(1, null, { checks: checks("removed", ["missing_criterion"], ["unknown_citation", "unknown_citation"]) } as never),
        prospect(2, null, { checks: checks("kept", []) } as never),
        prospect(3, null),
      ],
      {
        outreach_suppressed: { count: 1, company_ids: [1] },
        claim_violations: { count: 2, drafts: 1, by_code: { unknown_citation: 2 }, company_ids: [1] },
      } as never,
    );
    expect(out).toEqual({
      prospects_checked: 2,
      findings_by_code: { missing_criterion: 1, unknown_citation: 2 },
      outreach_by_decision: { kept: 1, removed: 1, none: 0 },
      claim_violations_by_code: { unknown_citation: 2 },
      outreach_suppressed: 1,
    });
    expect(JSON.stringify(out)).not.toContain("secret text");
  });

  it("formats the compact outreach line", () => {
    expect(
      formatOutreachLine({ prospects: 4, cited_fact_ids: 9, company_ids: [] }, { cited_fact_ids: 9, citeable: 7 }),
    ).toBe("outreach kept=4 cited=9 citeable=7 not_citeable=2");
  });
});
