// Request validation for live runs. Pure: no I/O, and a rejected field is
// named with a fixed message that never echoes the input.

export const ALLOWED_SIZES = ["11-50", "51-200"] as const;
export type AllowedSize = (typeof ALLOWED_SIZES)[number];

export type InvalidField = "code" | "icp" | "industry" | "country" | "sizes";

export const FIELD_MESSAGES: Readonly<Record<InvalidField, string>> = {
  code: "Enter your invite code (up to 64 characters).",
  icp: "Describe your ideal customer profile.",
  industry: "Industry must be 2 to 80 characters.",
  country: "Country must be India.",
  sizes: "Choose at least one company size: 11-50 or 51-200.",
};

export interface ValidRequest {
  readonly code: string;
  readonly icp: {
    readonly industry: string;
    readonly country: "India";
    readonly sizes: readonly AllowedSize[];
  };
}

export type Validation =
  | { readonly ok: true; readonly value: ValidRequest }
  | { readonly ok: false; readonly field: InvalidField; readonly message: string };

function bad(field: InvalidField): Validation {
  return { ok: false, field, message: FIELD_MESSAGES[field] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRequest(request: { code: unknown; icp: unknown }): Validation {
  const { code, icp } = request;
  if (typeof code !== "string" || code.trim() === "" || code.length > 64) return bad("code");
  if (!isRecord(icp)) return bad("icp");

  const industry = icp.industry;
  if (typeof industry !== "string") return bad("industry");
  const trimmed = industry.trim();
  if (trimmed.length < 2 || trimmed.length > 80) return bad("industry");

  if (icp.country !== "India") return bad("country");

  const sizes = icp.sizes;
  if (!Array.isArray(sizes) || sizes.length === 0) return bad("sizes");
  if (!sizes.every((s) => (ALLOWED_SIZES as readonly unknown[]).includes(s))) return bad("sizes");
  // Canonical order, no duplicates.
  const unique = ALLOWED_SIZES.filter((s) => sizes.includes(s));

  return { ok: true, value: { code, icp: { industry: trimmed, country: "India", sizes: unique } } };
}
