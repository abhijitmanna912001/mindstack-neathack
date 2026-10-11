import { describe, expect, it } from "vitest";
import { FIELD_MESSAGES, validateRequest } from "../../src/server/live/validate";

const icp = { industry: "Staffing", country: "India", sizes: ["11-50"] };

function field(request: { code: unknown; icp: unknown }) {
  const v = validateRequest(request);
  return v.ok ? null : v;
}

describe("validateRequest", () => {
  it("accepts a valid request and normalises it", () => {
    const v = validateRequest({
      code: "ABCD-1234",
      icp: { industry: "  Staffing  ", country: "India", sizes: ["51-200", "11-50", "11-50"] },
    });
    expect(v).toEqual({
      ok: true,
      value: { code: "ABCD-1234", icp: { industry: "Staffing", country: "India", sizes: ["11-50", "51-200"] } },
    });
  });

  it.each([undefined, null, 5, "", "   ", "x".repeat(65), {}, []])("rejects code %j", (code) => {
    expect(field({ code, icp })?.field).toBe("code");
  });

  it("accepts a 64-character code", () => {
    expect(validateRequest({ code: "x".repeat(64), icp }).ok).toBe(true);
  });

  it.each([undefined, null, "India", [], 3])("rejects icp %j", (bad) => {
    expect(field({ code: "c", icp: bad })?.field).toBe("icp");
  });

  it.each([undefined, 7, "a", " a ", "x".repeat(81), ["Staffing"]])("rejects industry %j", (industry) => {
    expect(field({ code: "c", icp: { ...icp, industry } })?.field).toBe("industry");
  });

  it("accepts industry lengths 2 and 80", () => {
    expect(validateRequest({ code: "c", icp: { ...icp, industry: "ab" } }).ok).toBe(true);
    expect(validateRequest({ code: "c", icp: { ...icp, industry: "x".repeat(80) } }).ok).toBe(true);
  });

  it.each([undefined, "india", "Nepal", ["India"]])("rejects country %j", (country) => {
    expect(field({ code: "c", icp: { ...icp, country } })?.field).toBe("country");
  });

  it.each([undefined, "11-50", [], ["1-10"], ["11-50", "201-500"], [11], [null]])("rejects sizes %j", (sizes) => {
    expect(field({ code: "c", icp: { ...icp, sizes } })?.field).toBe("sizes");
  });

  it("uses a fixed message per field and never echoes input", () => {
    const secret = "do-not-echo-me";
    for (const request of [
      { code: 5, icp },
      { code: secret, icp: { ...icp, industry: secret.repeat(10) } },
      { code: secret, icp: { ...icp, country: secret } },
      { code: secret, icp: { ...icp, sizes: [secret] } },
    ]) {
      const v = field(request);
      expect(v).not.toBeNull();
      expect(v!.message).toBe(FIELD_MESSAGES[v!.field]);
      expect(JSON.stringify(v)).not.toContain(secret);
    }
  });

  it("reports the first failing field in order: code, icp, industry, country, sizes", () => {
    expect(field({ code: "", icp: null })?.field).toBe("code");
    expect(field({ code: "c", icp: { industry: 1, country: "x", sizes: [] } })?.field).toBe("industry");
    expect(field({ code: "c", icp: { industry: "ok", country: "x", sizes: [] } })?.field).toBe("country");
  });
});
