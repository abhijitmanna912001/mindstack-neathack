// Client-side checks for the live-run form. The server re-validates every
// request; these checks give fast, helpful messages and keep obviously
// invalid requests from being sent.

import {
  LIVE_COMPANY_SIZES,
  LIVE_COUNTRY,
  type LiveCompanySize,
  type LiveRunRequest,
} from "./contract";

export const CODE_MAX_LENGTH = 64;
export const INDUSTRY_MIN_LENGTH = 2;
export const INDUSTRY_MAX_LENGTH = 80;

export interface LiveFormValues {
  readonly code: string;
  readonly industry: string;
  readonly sizes: readonly string[];
}

export type LiveFormField = "code" | "industry" | "sizes";
export type LiveFormErrors = Partial<Record<LiveFormField, string>>;

export const EMPTY_LIVE_FORM: LiveFormValues = { code: "", industry: "", sizes: [] };

// The agreed contract only requires non-empty text of at most 64 characters.
// The grouped form "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" is an example, not a rule, so no
// character set or grouping is enforced here.

function isCompanySize(value: string): value is LiveCompanySize {
  return (LIVE_COMPANY_SIZES as readonly string[]).includes(value);
}

export function validateLiveForm(
  values: LiveFormValues,
): { ok: true; request: LiveRunRequest } | { ok: false; errors: LiveFormErrors } {
  const errors: LiveFormErrors = {};
  const code = values.code.trim();
  const industry = values.industry.trim();

  if (code === "") {
    errors.code = "Enter your invitation code.";
  } else if (code.length > CODE_MAX_LENGTH) {
    errors.code = `Invitation codes are at most ${CODE_MAX_LENGTH} characters.`;
  }

  if (industry.length < INDUSTRY_MIN_LENGTH) {
    errors.industry = `Enter an industry of at least ${INDUSTRY_MIN_LENGTH} characters.`;
  } else if (industry.length > INDUSTRY_MAX_LENGTH) {
    errors.industry = `Keep the industry under ${INDUSTRY_MAX_LENGTH + 1} characters.`;
  }

  // Keep the fixed display order and drop anything unknown or repeated.
  const sizes = LIVE_COMPANY_SIZES.filter((size) => values.sizes.includes(size));
  if (sizes.length === 0 || values.sizes.some((s) => !isCompanySize(s))) {
    errors.sizes = "Select at least one company size.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { code, icp: { industry, country: LIVE_COUNTRY, sizes } } };
}

export function toggleSize(sizes: readonly string[], size: LiveCompanySize, checked: boolean): string[] {
  const rest = sizes.filter((s) => s !== size);
  return checked ? [...rest, size] : rest;
}
