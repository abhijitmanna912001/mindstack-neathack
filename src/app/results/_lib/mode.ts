// The only run mode the results page supports. The results page has no live
// execution path (live runs happen only on the invite-only /live page):
// anything other than the synthetic mode is rejected on the server before
// any provider, model client or pipeline is constructed.

export const SYNTHETIC_MODE = "synthetic";

export type ModeCheck =
  | { readonly ok: true; readonly mode: typeof SYNTHETIC_MODE }
  | { readonly ok: false; readonly reason: string };

// The reason for exactly ?mode=live.
export const LIVE_MODE_REASON =
  "Only synthetic mode is available on this page. The mode=live parameter does not start a live run.";

// The reason for every other rejected value (an unknown mode, an empty
// string, a repeated parameter, ...).
export const UNSUPPORTED_MODE_REASON =
  "Only synthetic mode is available on this page. The requested mode is not supported.";

// Accepts the raw `mode` search parameter: absent means synthetic. A repeated
// parameter arrives as an array and is rejected, as is an empty string or any
// other value ("live", "crustdata", ...). Only the reason differs for "live".
export function parseRequestedMode(value: unknown): ModeCheck {
  if (value === undefined || value === SYNTHETIC_MODE) {
    return { ok: true, mode: SYNTHETIC_MODE };
  }
  return { ok: false, reason: value === "live" ? LIVE_MODE_REASON : UNSUPPORTED_MODE_REASON };
}
