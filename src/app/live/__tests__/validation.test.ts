import { describe, expect, it } from "vitest";
import { toggleSize, validateLiveForm, type LiveFormValues } from "../_lib/validation";

const valid: LiveFormValues = { code: "ABCDE-FGHIJ-KLMNO-PQRST", industry: "Staffing and Recruiting", sizes: ["11-50"] };
const form = (overrides: Partial<LiveFormValues>): LiveFormValues => ({ ...valid, ...overrides });

describe("invitation code", () => {
  it.each(["", " ", "   ", "\t", "\n", " \t\n "])("is required, so %j is rejected", (code) => {
    const r = validateLiveForm(form({ code }));
    expect(!r.ok && r.errors.code).toBe("Enter your invitation code.");
  });

  // The grouped format is an example, not a rule: any non-empty text up to 64
  // characters is accepted, with no character-set or grouping restriction.
  it.each([
    "ABCDE-FGHIJ-KLMNO-PQRST",
    "abcde-fghij-klmno-pqrst",
    "ABCDEFGHIJKLMNOPQRST",
    "ABCDE FGHIJ KLMNO PQRST",
    "  ABCDE-FGHIJ  ",
    "A",
    "ABCDE--FGHIJ",
    "-ABCDE",
    "ABCDE-",
    "ABC/DEF",
    "ABC_DEF",
    "ABC DEF;",
    "beta.invite+42",
    "<script>",
    "कोड-123",
  ])("accepts %j", (code) => {
    const r = validateLiveForm(form({ code }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.request.code).toBe(code.trim());
  });

  it("accepts exactly 64 characters and rejects 65", () => {
    expect(validateLiveForm(form({ code: "A".repeat(64) })).ok).toBe(true);
    expect(validateLiveForm(form({ code: "-_/.".repeat(16) })).ok).toBe(true);
    const r = validateLiveForm(form({ code: "A".repeat(65) }));
    expect(!r.ok && r.errors.code).toBe("Invitation codes are at most 64 characters.");
  });

  it("measures the length after trimming surrounding whitespace", () => {
    const r = validateLiveForm(form({ code: `  ${"A".repeat(64)}  ` }));
    expect(r.ok && r.request.code).toBe("A".repeat(64));
  });
});

describe("industry", () => {
  it("needs at least 2 characters after trimming", () => {
    expect(validateLiveForm(form({ industry: " a " })).ok).toBe(false);
    expect(validateLiveForm(form({ industry: "IT" })).ok).toBe(true);
  });

  it("allows up to 80 characters", () => {
    expect(validateLiveForm(form({ industry: "x".repeat(80) })).ok).toBe(true);
    const r = validateLiveForm(form({ industry: "x".repeat(81) }));
    expect(!r.ok && r.errors.industry).toBeTruthy();
  });

  it("sends the user's text trimmed, without resolving it", () => {
    const r = validateLiveForm(form({ industry: "  recruiting agencies  " }));
    expect(r.ok && r.request.icp.industry).toBe("recruiting agencies");
  });
});

describe("company size", () => {
  it("requires at least one selection", () => {
    const r = validateLiveForm(form({ sizes: [] }));
    expect(!r.ok && r.errors.sizes).toBe("Select at least one company size.");
  });

  it("allows either or both, in a fixed order", () => {
    expect(validateLiveForm(form({ sizes: ["51-200"] })).ok).toBe(true);
    const both = validateLiveForm(form({ sizes: ["51-200", "11-50"] }));
    expect(both.ok && both.request.icp.sizes).toEqual(["11-50", "51-200"]);
  });

  it("rejects sizes outside the beta", () => {
    expect(validateLiveForm(form({ sizes: ["11-50", "201-500"] })).ok).toBe(false);
  });

  it("toggles a size on and off without duplicates", () => {
    expect(toggleSize([], "11-50", true)).toEqual(["11-50"]);
    expect(toggleSize(["11-50"], "11-50", true)).toEqual(["11-50"]);
    expect(toggleSize(["11-50", "51-200"], "11-50", false)).toEqual(["51-200"]);
  });
});

describe("request", () => {
  it("is India-only and matches the planned contract", () => {
    const r = validateLiveForm(valid);
    expect(r).toEqual({
      ok: true,
      request: { code: valid.code, icp: { industry: valid.industry, country: "India", sizes: ["11-50"] } },
    });
  });

  it("reports every field error at once", () => {
    const r = validateLiveForm({ code: "", industry: "", sizes: [] });
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["code", "industry", "sizes"]);
  });
});
