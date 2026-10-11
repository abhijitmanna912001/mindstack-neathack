// Invite-code generation and hashing. Codes and secrets are never logged and
// never appear in error messages.

import { createHmac, randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MIN_SECRET_LENGTH = 32;
const GROUP_SIZE = 4;

// 20 random bytes = 160 bits = exactly 32 base32 characters, in 8 groups of 4.
export function generateInviteCode(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  const groups: string[] = [];
  for (let i = 0; i < out.length; i += GROUP_SIZE) {
    groups.push(out.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[-\s]/g, "");
}

function requireSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `HMAC secret must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
}

export function hashCode(code: string, secret: string): string {
  requireSecret(secret);
  return createHmac("sha256", secret).update(normalizeCode(code)).digest("hex");
}

export function hashIp(ip: string, secret: string): string {
  requireSecret(secret);
  return createHmac("sha256", secret).update(`ip:v1:${ip.trim()}`).digest("hex");
}
