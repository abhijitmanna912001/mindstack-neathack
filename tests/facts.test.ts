import { describe, expect, it } from "vitest";
import { buildFacts } from "../src/core/data/facts";
import { validateCompanies } from "../src/core/data/validation";
import { FIXTURE_COMPANIES } from "../src/core/fixtures/companies";
import type { RawCompany } from "../src/core/types";

const validations = validateCompanies(FIXTURE_COMPANIES);

function build(id: number) {
  const i = FIXTURE_COMPANIES.findIndex((c) => c.crustdata_company_id === id);
  return buildFacts(FIXTURE_COMPANIES[i], validations[i], "fixture");
}

describe("buildFacts", () => {
  it("gives facts for a clean record", () => {
    const facts = build(1001);
    const range = facts.find((f) => f.id === "1001:employee_count_range");
    expect(range).toMatchObject({
      value: "51-200",
      claim: "Employee count range is 51-200",
      status: "given",
      field: "employee_count_range",
      source: {
        provider: "fixture",
        operation: "company_enrich",
        record_id: "1001",
        retrieved_at: "2026-01-15T09:00:00Z",
      },
    });
    expect(facts.find((f) => f.id === "1001:name")?.status).toBe("given");
    // Empty logo and absent optional fields produce no facts.
    expect(facts.some((f) => f.field === "logo")).toBe(false);
    expect(facts.some((f) => f.field === "description")).toBe(false);
    expect(facts.some((f) => f.source.provider === "model")).toBe(false);
  });

  it("uses company_search for search records", () => {
    const raw: RawCompany = { ...FIXTURE_COMPANIES[0], source: "search" };
    const facts = buildFacts(raw, { status: "valid", issues: [] }, "crustdata");
    expect(facts[0].source).toMatchObject({
      provider: "crustdata",
      operation: "company_search",
    });
  });

  it("marks the website uncertain on a junk website", () => {
    const facts = build(1003);
    const site = facts.find((f) => f.id === "1003:website");
    expect(site?.status).toBe("uncertain");
    expect(site?.claim).toContain("wa.link");
    expect(facts.some((f) => f.id.includes("xcheck:website_domain"))).toBe(false);
  });

  it("marks every size field uncertain on a size mismatch", () => {
    const facts = build(1008);
    const hc = facts.find((f) => f.id === "1008:latest_headcount");
    const range = facts.find((f) => f.id === "1008:employee_count_range");
    expect(hc?.status).toBe("uncertain");
    expect(hc?.claim).toContain("outside the listed size range");
    expect(range?.status).toBe("uncertain");
    expect(range?.claim).toContain("contradict each other");
    expect(facts.some((f) => f.id.includes("headcount_in_range"))).toBe(false);
    expect(facts.some((f) => f.status === "cross_checked")).toBe(true); // website_domain only
  });

  it("marks all size fields uncertain on implausible revenue per employee", () => {
    const facts = build(1009);
    for (const field of [
      "employee_count_range",
      "latest_headcount",
      "revenue_range",
    ]) {
      const f = facts.find((x) => x.id === `1009:${field}`);
      expect(f?.status).toBe("uncertain");
      expect(f?.claim).toContain("contradict each other");
    }
    expect(facts.some((f) => f.id.includes("headcount_in_range"))).toBe(false);
    expect(facts.find((f) => f.id === "1009:name")?.status).toBe("given");
  });

  it.each([0, -5, NaN])("produces no headcount fact for %s", (n) => {
    const raw: RawCompany = { ...FIXTURE_COMPANIES[0], latest_headcount: n };
    const facts = buildFacts(raw, { status: "valid", issues: [] }, "fixture");
    expect(facts.some((f) => f.field === "latest_headcount")).toBe(false);
    expect(facts.some((f) => f.id.includes("headcount_in_range"))).toBe(false);
  });

  it("cross-checks only when both facts agree", () => {
    const clean = build(1001);
    const web = clean.find((f) => f.id === "1001:xcheck:website_domain");
    expect(web).toMatchObject({
      status: "cross_checked",
      source: { provider: "derived" },
      derived_from: ["1001:website", "1001:primary_domain"],
    });
    const size = clean.find((f) => f.id === "1001:xcheck:headcount_in_range");
    expect(size?.derived_from).toEqual([
      "1001:latest_headcount",
      "1001:employee_count_range",
    ]);

    // Website host differs from the domain: no website cross-check.
    const raw: RawCompany = {
      ...FIXTURE_COMPANIES[0],
      website: "https://other.example",
    };
    const facts = buildFacts(raw, { status: "valid", issues: [] }, "fixture");
    expect(facts.some((f) => f.id.endsWith("xcheck:website_domain"))).toBe(false);
  });

  it("returns an empty array for rejected records", () => {
    expect(validations[4].status).toBe("rejected");
    expect(build(1005)).toEqual([]);
  });

  it("builds optional enrichment facts", () => {
    const raw: RawCompany = {
      ...FIXTURE_COMPANIES[0],
      description: "Makes widgets",
      founded_year: 2010,
      location: { country: "Ireland", city: "" },
      specialities: ["a", "", "b"],
      linkedin_followers: 5,
    };
    const facts = buildFacts(raw, { status: "valid", issues: [] }, "fixture");
    const ids = facts.map((f) => f.id);
    expect(ids).toContain("1001:description");
    expect(ids).toContain("1001:founded_year");
    expect(ids).toContain("1001:location.country");
    expect(ids).not.toContain("1001:location.city");
    expect(facts.find((f) => f.id === "1001:specialities")?.value).toEqual([
      "a",
      "b",
    ]);
  });

  it("is deterministic with unique ids", () => {
    const a = build(1001);
    const b = build(1001);
    expect(a).toEqual(b);
    expect(new Set(a.map((f) => f.id)).size).toBe(a.length);
  });

  it("does not mutate its inputs", () => {
    const raw: RawCompany = JSON.parse(JSON.stringify(FIXTURE_COMPANIES[7]));
    const validation = JSON.parse(JSON.stringify(validations[7]));
    const rawCopy = JSON.parse(JSON.stringify(raw));
    const validationCopy = JSON.parse(JSON.stringify(validation));
    buildFacts(raw, validation, "fixture");
    expect(raw).toEqual(rawCopy);
    expect(validation).toEqual(validationCopy);
  });
});
