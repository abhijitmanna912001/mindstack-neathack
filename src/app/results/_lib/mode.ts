// The only run mode the results page supports. This web app has no live
// execution path: anything other than the synthetic mode is rejected on the
// server before any provider, model client or pipeline is constructed.

export const SYNTHETIC_MODE = "synthetic";

export type ModeCheck =
  | { readonly ok: true; readonly mode: typeof SYNTHETIC_MODE }
  | { readonly ok: false; readonly reason: string };

export const UNSUPPORTED_MODE_REASON =
  "Only synthetic mode is available on this page. Live Crustdata and real-model runs are not supported by the web app.";

// Accepts the raw `mode` search parameter: absent means synthetic. A repeated
// parameter arrives as an array and is rejected, as is an empty string or any
// other value ("live", "crustdata", ...).
export function parseRequestedMode(value: unknown): ModeCheck {
  if (value === undefined || value === SYNTHETIC_MODE) {
    return { ok: true, mode: SYNTHETIC_MODE };
  }
  return { ok: false, reason: UNSUPPORTED_MODE_REASON };
}
