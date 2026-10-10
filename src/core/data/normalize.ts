// Normalisers used for duplicate detection and junk-host checks.
// Pure string helpers: no network, no throwing.

const PROTOCOL = /^[a-z][a-z0-9+.-]*:\/\//;

// Lowercased host only: no protocol, "www.", port, path, query, hash,
// trailing slash or trailing dot. Returns "" when nothing is left.
export function normalizeDomain(input: string): string {
  let s = String(input ?? "").trim().toLowerCase();
  s = s.replace(PROTOCOL, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/^[^@]*@/, ""); // user:pass@host
  s = s.replace(/:\d+$/, ""); // port
  s = s.replace(/^www\./, "");
  s = s.replace(/\.+$/, "");
  return s;
}

// Lowercased LinkedIn URL without protocol, "www.", query, hash or trailing
// slash. Returns "" when nothing is left.
export function normalizeLinkedInUrl(input: string): string {
  let s = String(input ?? "").trim().toLowerCase();
  s = s.replace(PROTOCOL, "");
  s = s.replace(/^www\./, "");
  s = s.split(/[?#]/)[0] ?? "";
  s = s.replace(/\/+$/, "");
  return s;
}
