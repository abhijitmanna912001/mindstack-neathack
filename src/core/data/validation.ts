// Code-rule validation of raw companies. Pure and deterministic: the same
// input always gives the same output, and no rule ever throws.

import type {
  RawCompany,
  Validation,
  ValidationIssue,
  ValidationStatus,
} from "../types";
import { normalizeDomain, normalizeLinkedInUrl } from "./normalize";

// Hosts that are messaging, link-shortener or social pages, not real sites.
export const JUNK_HOSTS: readonly string[] = [
  "wa.link",
  "wa.me",
  "bit.ly",
  "linktr.ee",
  "facebook.com",
  "instagram.com",
  "t.me",
];

// Above this implied revenue per employee (USD) the data is not believable.
export const MAX_REVENUE_PER_EMPLOYEE_USD = 500000;

interface Range {
  readonly min: number;
  readonly max: number; // Infinity for open-ended ranges like "10,001+"
}

function toNumber(text: string): number | undefined {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

// "51-200" -> {51, 200}; "10,001+" -> {10001, Infinity}; else undefined.
export function parseEmployeeRange(input: unknown): Range | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.trim();
  const span = /^(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)$/.exec(s);
  if (span) {
    const min = toNumber(span[1]);
    const max = toNumber(span[2]);
    if (min === undefined || max === undefined || max < min) return undefined;
    return { min, max };
  }
  const open = /^(\d[\d,]*)\s*\+$/.exec(s);
  if (open) {
    const min = toNumber(open[1]);
    return min === undefined ? undefined : { min, max: Infinity };
  }
  return undefined;
}

const SUFFIX: Readonly<Record<string, number>> = {
  "": 1,
  k: 1e3,
  m: 1e6,
  b: 1e9,
};

// Lower bound in USD of a range like "$10M-$50M", "$500K-$1M" or "$10M+".
// Undefined for anything else (e.g. "<$1M", "unknown").
export function parseRevenueLowerBound(input: unknown): number | undefined {
  if (typeof input !== "string") return undefined;
  const m = /^\$?\s*(\d[\d,]*(?:\.\d+)?)\s*([kmb]?)\s*(?:[-–]|to\b|\+|$)/i.exec(
    input.trim(),
  );
  if (!m) return undefined;
  const base = toNumber(m[1]);
  if (base === undefined) return undefined;
  return base * (SUFFIX[m[2].toLowerCase()] ?? 1);
}

function isEmpty(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function isJunkHost(host: string): boolean {
  return JUNK_HOSTS.some((j) => host === j || host.endsWith(`.${j}`));
}

// Key used to group duplicates: domain first, LinkedIn URL when no domain.
function duplicateKey(raw: RawCompany): string | undefined {
  const domain = normalizeDomain(raw.primary_domain);
  if (domain) return `domain:${domain}`;
  const linkedin = normalizeLinkedInUrl(raw.professional_network_url);
  if (linkedin) return `linkedin:${linkedin}`;
  return undefined;
}

function sizeIssues(raw: RawCompany): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const headcount = raw.latest_headcount;
  if (
    typeof headcount !== "number" ||
    !Number.isFinite(headcount) ||
    headcount <= 0
  ) {
    return issues;
  }

  const range = parseEmployeeRange(raw.employee_count_range);
  if (range && (headcount < range.min || headcount > range.max)) {
    issues.push({
      code: "size_headcount_mismatch",
      field: "latest_headcount",
      reason: `Headcount ${headcount} is outside the listed size range "${raw.employee_count_range}".`,
    });
  }

  const revenueMin = parseRevenueLowerBound(raw.revenue_range);
  if (
    revenueMin !== undefined &&
    revenueMin / headcount > MAX_REVENUE_PER_EMPLOYEE_USD
  ) {
    issues.push({
      code: "size_headcount_mismatch",
      field: "revenue_range",
      reason: `Revenue "${raw.revenue_range}" with ${headcount} employees implies more than $${MAX_REVENUE_PER_EMPLOYEE_USD.toLocaleString("en-US")} per employee, which is implausible.`,
    });
  }
  return issues;
}

export function validateCompanies(
  raws: readonly RawCompany[],
): readonly Validation[] {
  const firstSeen = new Map<string, number>(); // key -> crustdata_company_id

  return raws.map((raw): Validation => {
    const issues: ValidationIssue[] = [];

    const noName = isEmpty(raw.name);
    const domain = normalizeDomain(raw.primary_domain ?? "");
    const linkedin = normalizeLinkedInUrl(raw.professional_network_url ?? "");

    if (noName) {
      issues.push({
        code: "missing_name",
        field: "name",
        reason: "The company has no name.",
      });
    }
    if (!domain) {
      issues.push({
        code: "missing_domain",
        field: "primary_domain",
        reason: "The company has no primary domain.",
      });
    }

    const host = normalizeDomain(raw.website ?? "");
    if (host && isJunkHost(host)) {
      issues.push({
        code: "junk_website",
        field: "website",
        reason: `The website points to ${host}, a messaging, link-shortener or social page rather than a company site.`,
      });
    }

    if (!linkedin) {
      issues.push({
        code: "missing_linkedin",
        field: "professional_network_url",
        reason: "The company has no LinkedIn page.",
      });
    }

    let isLaterDuplicate = false;
    const key = duplicateKey(raw);
    if (key !== undefined) {
      const keptId = firstSeen.get(key);
      if (keptId === undefined) {
        firstSeen.set(key, raw.crustdata_company_id);
      } else {
        isLaterDuplicate = true;
        const viaDomain = key.startsWith("domain:");
        issues.push({
          code: "duplicate_domain",
          field: viaDomain ? "primary_domain" : "professional_network_url",
          reason: viaDomain
            ? `Another company (id ${keptId}) already uses the domain ${domain}.`
            : `Another company (id ${keptId}) already uses the LinkedIn page ${linkedin}.`,
          related_company_id: keptId,
        });
      }
    }

    issues.push(...sizeIssues(raw));

    let status: ValidationStatus;
    if ((noName && !domain && !linkedin) || isLaterDuplicate) {
      status = "rejected";
    } else if (issues.length > 0) {
      status = "flagged";
    } else {
      status = "valid";
    }
    return { status, issues };
  });
}
