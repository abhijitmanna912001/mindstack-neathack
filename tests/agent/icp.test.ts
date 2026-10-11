import { describe, expect, it } from "vitest";
import { COMPANY_SIZE_OPTIONS } from "../../src/app/_lib/icp-form";
import { assessmentCriteria, describeIcp } from "../../src/core/agent/icp";
import { FIXTURE_COMPANIES } from "../../src/core/fixtures/companies";
import { OPEN_ICP, icp } from "./helpers";

describe("describeIcp", () => {
  it("describes an open profile", () => {
    expect(describeIcp(OPEN_ICP)).toBe(
      "Companies in any industry of any size in any location.",
    );
  });

  it("describes a full profile", () => {
    expect(
      describeIcp(
        icp({
          industry: "Software",
          employee_count_ranges: ["51-200"],
          locations: ["Germany"],
          keywords: ["payments"],
          excluded_domains: ["rival.example"],
        }),
      ),
    ).toBe(
      "Companies in Software with 51-200 employees located in Germany, matching: payments, excluding: rival.example.",
    );
  });
});

describe("assessmentCriteria", () => {
  it("lists only the parts of the ICP that were filled in", () => {
    expect(assessmentCriteria(icp({ industry: "Data", keywords: ["ml"] }))).toEqual([
      "Industry: Data",
      "Keywords: ml",
    ]);
  });
});

// The form's size options must be values the provider understands. Only the
// ranges seen in the fixtures are confirmed; the rest need checking against
// Crustdata's real values before live use.
describe("company size options vs provider ranges", () => {
  const fixtureRanges = new Set(
    FIXTURE_COMPANIES.map((c) => c.employee_count_range).filter((r) => r !== ""),
  );

  it("confirms the options that appear in the fixture data", () => {
    const confirmed = COMPANY_SIZE_OPTIONS.map((o) => o.value).filter((v) => fixtureRanges.has(v));
    expect(confirmed).toEqual(["1-10", "11-50", "51-200", "201-500"]);
  });

  it("flags the options with no matching provider range yet", () => {
    const unconfirmed = COMPANY_SIZE_OPTIONS.map((o) => o.value).filter((v) => !fixtureRanges.has(v));
    expect(unconfirmed).toEqual(["501-1000", "1001-5000", "5001+"]);
  });
});
