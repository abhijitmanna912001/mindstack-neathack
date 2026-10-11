import { describe, expect, it } from "vitest";
import {
  generateInviteCode,
  hashCode,
  hashIp,
  normalizeCode,
} from "../../src/server/live/codes";

const SECRET = "s".repeat(40);
const OTHER = "t".repeat(40);

describe("generateInviteCode", () => {
  it("is 32 Crockford base32 characters in dash-separated groups", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it("does not repeat", () => {
    const codes = new Set(Array.from({ length: 200 }, generateInviteCode));
    expect(codes.size).toBe(200);
  });
});

describe("normalizeCode", () => {
  it("trims, uppercases and removes dashes and spaces", () => {
    expect(normalizeCode("  ab12-cd 34-ef  ")).toBe("AB12CD34EF");
  });
});

describe("hashCode / hashIp", () => {
  it("is a stable hex HMAC independent of formatting", () => {
    const a = hashCode("ABCD-1234", SECRET);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode(" abcd 1234 ", SECRET)).toBe(a);
  });

  it("depends on the secret", () => {
    expect(hashCode("ABCD1234", SECRET)).not.toBe(hashCode("ABCD1234", OTHER));
    expect(hashIp("1.2.3.4", SECRET)).not.toBe(hashIp("1.2.3.4", OTHER));
  });

  it("uses a different domain for ips than for codes", () => {
    expect(hashIp("ABCD1234", SECRET)).not.toBe(hashCode("ABCD1234", SECRET));
  });

  it("rejects short secrets without leaking code or secret", () => {
    const short = "short-secret-value";
    for (const fn of [
      () => hashCode("SECRETCODE99", short),
      () => hashIp("9.9.9.9", short),
    ]) {
      let message = "";
      try {
        fn();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(short);
      expect(message).not.toContain("SECRETCODE99");
      expect(message).not.toContain("9.9.9.9");
    }
  });
});
