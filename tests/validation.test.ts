import { describe, expect, it } from "vitest";
import { FIXTURE_COMPANIES } from "../src/core/fixtures/companies";
import { normalizeDomain, normalizeLinkedInUrl } from "../src/core/data/normalize";
import {
  JUNK_HOSTS,
  MAX_REVENUE_PER_EMPLOYEE_USD,
  validateCompanies,
} from "../src/core/data/validation";
import type { RawCompany, ValidationIssueCode } from "../src/core/types";

const clean = FIXTURE_COMPANIES[0];

function make(overrides: Partial<RawCompany>): RawCompany {
  return { ...clean, ...overrides };
}

function codes(raw: RawCompany): ValidationIssueCode[] {
  return validateCompanies([raw])[0].issues.map((i) => i.code);
}

describe("normalize", () => {
  it("normalises domains", () => {
    expect(normalizeDomain("HTTPS://www.Acme.com/path?q=1")).toBe("acme.com");
    expect(normalizeDomain("acme.com./")).toBe("acme.com");
    expect(normalizeDomain("   ")).toBe("");
  });
  it("normalises LinkedIn URLs", () => {
    expect(
      normalizeLinkedInUrl("https://www.LinkedIn.com/company/Acme/?trk=x"),
    ).toBe("linkedin.com/company/acme");
  });
});

describe("rules", () => {
  it("passes a clean record", () => {
    expect(validateCompanies([clean])[0]).toEqual({ status: "valid", issues: [] });
  });

  it("missing_name", () => {
    expect(codes(make({ name: "   " }))).toEqual(["missing_name"]);
  });

  it("missing_domain", () => {
    expect(codes(make({ primary_domain: "" }))).toEqual(["missing_domain"]);
  });

  it("junk_website for every junk host", () => {
    for (const host of JUNK_HOSTS) {
      expect(codes(make({ website: `https://www.${host}/x` }))).toEqual([
        "junk_website",
      ]);
    }
    expect(codes(make({ website: "https://notbit.ly.example" }))).toEqual([]);
  });

  it("missing_linkedin", () => {
    expect(codes(make({ professional_network_url: "" }))).toEqual([
      "missing_linkedin",
    ]);
  });

  it("duplicate_domain keeps the first and points later ones at it", () => {
    const a = make({ crustdata_company_id: 1 });
    const b = make({
      crustdata_company_id: 2,
      primary_domain: "WWW.BrightwaterLabs.example/",
    });
    const [va, vb] = validateCompanies([a, b]);
    expect(va.issues).toEqual([]);
    expect(vb.issues).toHaveLength(1);
    expect(vb.issues[0]).toMatchObject({
      code: "duplicate_domain",
      related_company_id: 1,
    });
  });

  it("duplicate_domain falls back to LinkedIn URL when there is no domain", () => {
    const a = make({ crustdata_company_id: 1, primary_domain: "" });
    const b = make({
      crustdata_company_id: 2,
      primary_domain: "",
      professional_network_url: clean.professional_network_url.toUpperCase() + "/",
    });
    const [, vb] = validateCompanies([a, b]);
    expect(vb.issues.map((i) => i.code)).toContain("duplicate_domain");
    expect(vb.issues.find((i) => i.code === "duplicate_domain")).toMatchObject({
      related_company_id: 1,
    });
  });

  it("size_headcount_mismatch for headcount outside range", () => {
    expect(
      codes(make({ employee_count_range: "11-50", latest_headcount: 640 })),
    ).toEqual(["size_headcount_mismatch"]);
    expect(
      codes(make({ employee_count_range: "11-50", latest_headcount: 30 })),
    ).toEqual([]);
    expect(
      codes(make({ employee_count_range: "10,001+", latest_headcount: 500 })),
    ).toEqual(["size_headcount_mismatch"]);
  });

  it("size_headcount_mismatch for implausible revenue per employee", () => {
    expect(MAX_REVENUE_PER_EMPLOYEE_USD).toBe(500000);
    expect(
      codes(
        make({
          employee_count_range: "1-10",
          latest_headcount: 4,
          revenue_range: "$10M-$50M",
        }),
      ),
    ).toEqual(["size_headcount_mismatch"]);
    expect(
      codes(
        make({
          employee_count_range: "51-200",
          latest_headcount: 120,
          revenue_range: "$10M-$50M",
        }),
      ),
    ).toEqual([]);
  });

  it("skips the size rule when data is missing or oddly formatted", () => {
    expect(codes(make({ latest_headcount: undefined, employee_count_range: "1-2" }))).toEqual([]);
    expect(codes(make({ employee_count_range: "lots", latest_headcount: 5, revenue_range: undefined }))).toEqual([]);
    expect(codes(make({ revenue_range: "<$1M", latest_headcount: 120 }))).toEqual([]);
    expect(codes(make({ revenue_range: "unknown", latest_headcount: 120 }))).toEqual([]);
    expect(codes(make({ latest_headcount: 0, revenue_range: "$10M-$50M" }))).toEqual([]);
  });
});

describe("status", () => {
  it("is rejected when name, domain and LinkedIn are all missing", () => {
    const v = validateCompanies([
      make({ name: "", primary_domain: "", professional_network_url: "" }),
    ])[0];
    expect(v.status).toBe("rejected");
  });

  it("is flagged for a missing name alone", () => {
    expect(validateCompanies([make({ name: "" })])[0].status).toBe("flagged");
  });

  it("is rejected for a later duplicate but not the kept one", () => {
    const a = make({ crustdata_company_id: 1 });
    const b = make({ crustdata_company_id: 2 });
    expect(validateCompanies([a, b]).map((v) => v.status)).toEqual([
      "valid",
      "rejected",
    ]);
  });

  it("gives the expected verdicts on the fixtures, aligned by index", () => {
    const result = validateCompanies(FIXTURE_COMPANIES);
    expect(result).toHaveLength(FIXTURE_COMPANIES.length);
    expect(result.map((v) => v.status)).toEqual([
      "valid", // clean
      "flagged", // LinkedIn only
      "flagged", // wa.link
      "valid", // kept
      "rejected", // later duplicate
      "flagged", // no domain
      "valid", // messy name is not a rule
      "flagged", // headcount outside range
      "flagged", // implausible revenue
      "rejected", // nothing identifying
    ]);
  });

  it("is deterministic and does not mutate input", () => {
    const before = JSON.stringify(FIXTURE_COMPANIES);
    expect(validateCompanies(FIXTURE_COMPANIES)).toEqual(
      validateCompanies(FIXTURE_COMPANIES),
    );
    expect(JSON.stringify(FIXTURE_COMPANIES)).toBe(before);
  });
});

describe("odd inputs", () => {
  it("never throw", () => {
    const odd = [
      make({ latest_headcount: NaN, employee_count_range: "5-1" }),
      make({ latest_headcount: Infinity, revenue_range: "$1e99M" }),
      make({ website: "::::", primary_domain: "http://", name: "\u0000" }),
      make({ employee_count_range: "-", revenue_range: "-$", latest_headcount: -5 }),
      { ...clean, name: undefined, website: null, primary_domain: 5 } as unknown as RawCompany,
    ];
    expect(() => validateCompanies(odd)).not.toThrow();
    expect(validateCompanies(odd)).toHaveLength(odd.length);
    expect(validateCompanies([])).toEqual([]);
  });
});
