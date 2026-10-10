// Builds facts from a raw company. Pure and deterministic: no network, no
// randomness, no mutation of the inputs. Statuses are set here by code only;
// this module never creates a fact with provider "model".

import type {
  AnyFact,
  Fact,
  FactSource,
  RawCompany,
  Validation,
} from "../types";
import { normalizeDomain } from "./normalize";
import { parseEmployeeRange } from "./validation";

type CrustProvider = "crustdata" | "fixture";

// Issue codes that make the fact on the issue's field uncertain.
const UNCERTAIN_CODES: ReadonlySet<string> = new Set([
  "junk_website",
  "size_headcount_mismatch",
]);

const SIZE_FIELDS: readonly string[] = [
  "employee_count_range",
  "latest_headcount",
  "revenue_range",
];

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildFacts(
  raw: RawCompany,
  validation: Validation,
  provider: CrustProvider,
): readonly AnyFact[] {
  if (validation.status === "rejected") return [];

  const recordId = String(raw.crustdata_company_id);
  const source: FactSource = {
    provider,
    operation: raw.source === "enrich" ? "company_enrich" : "company_search",
    record_id: recordId,
    retrieved_at: raw.retrieved_at,
  };

  // field -> why it is uncertain. A size mismatch means the size facts
  // contradict each other and we cannot tell which is wrong, so all of them
  // are marked, not only the field the rule looked at.
  const uncertainReason = new Map<string, string>();
  for (const issue of validation.issues) {
    if (!UNCERTAIN_CODES.has(issue.code)) continue;
    if (issue.code === "size_headcount_mismatch") {
      const reason = `${issue.reason} The size facts contradict each other, so none of them can be trusted.`;
      for (const field of SIZE_FIELDS) {
        if (!uncertainReason.has(field)) uncertainReason.set(field, reason);
      }
    } else if (!uncertainReason.has(issue.field)) {
      uncertainReason.set(issue.field, issue.reason);
    }
  }

  const facts: AnyFact[] = [];
  const byField = new Map<string, AnyFact>();

  const add = (field: string, value: unknown, claim: string): void => {
    const reason = uncertainReason.get(field);
    const fact: Fact<unknown> = {
      id: `${recordId}:${field}`,
      value,
      claim: reason ? `${claim} (uncertain: ${reason})` : claim,
      field,
      source,
      status: reason ? "uncertain" : "given",
    };
    facts.push(fact);
    byField.set(field, fact);
  };

  const text = (field: string, value: unknown, label: string): void => {
    if (nonEmptyText(value)) add(field, value, `${label} is ${value}`);
  };

  text("name", raw.name, "Company name");
  text("primary_domain", raw.primary_domain, "Primary domain");
  text("website", raw.website, "Website");
  text(
    "professional_network_url",
    raw.professional_network_url,
    "LinkedIn page",
  );
  text("employee_count_range", raw.employee_count_range, "Employee count range");
  text("industry", raw.industry, "Industry");
  text("description", raw.description, "Description");

  if (finiteNumber(raw.founded_year)) {
    add("founded_year", raw.founded_year, `Founded in ${raw.founded_year}`);
  }
  text("legal_type", raw.legal_type, "Legal type");
  if (finiteNumber(raw.latest_headcount) && raw.latest_headcount > 0) {
    add(
      "latest_headcount",
      raw.latest_headcount,
      `Latest headcount is ${raw.latest_headcount}`,
    );
  }
  text("revenue_range", raw.revenue_range, "Revenue range");
  text("location.country", raw.location?.country, "Country");
  text("location.city", raw.location?.city, "City");

  if (Array.isArray(raw.specialities)) {
    const list = raw.specialities.filter(nonEmptyText);
    if (list.length > 0) {
      add("specialities", list, `Specialities are ${list.join(", ")}`);
    }
  }
  if (finiteNumber(raw.linkedin_followers)) {
    add(
      "linkedin_followers",
      raw.linkedin_followers,
      `Has ${raw.linkedin_followers} LinkedIn followers`,
    );
  }

  // Derived cross-checks: two independent, non-uncertain facts that agree.
  const usable = (field: string): AnyFact | undefined => {
    const f = byField.get(field);
    return f && f.status === "given" ? f : undefined;
  };
  const derivedSource: FactSource = {
    provider: "derived",
    retrieved_at: raw.retrieved_at,
  };

  const website = usable("website");
  const domain = usable("primary_domain");
  if (website && domain) {
    const host = normalizeDomain(String(website.value));
    if (host !== "" && host === normalizeDomain(String(domain.value))) {
      facts.push({
        id: `${recordId}:xcheck:website_domain`,
        value: host,
        claim: `Website host matches the primary domain (${host})`,
        field: "website_domain",
        source: derivedSource,
        status: "cross_checked",
        derived_from: [website.id, domain.id],
      });
    }
  }

  const headcount = usable("latest_headcount");
  const rangeFact = usable("employee_count_range");
  if (headcount && rangeFact) {
    const range = parseEmployeeRange(rangeFact.value);
    const n = headcount.value as number;
    if (range && n >= range.min && n <= range.max) {
      facts.push({
        id: `${recordId}:xcheck:headcount_in_range`,
        value: n,
        claim: `Headcount ${n} is within the employee count range ${String(rangeFact.value)}`,
        field: "headcount_in_range",
        source: derivedSource,
        status: "cross_checked",
        derived_from: [headcount.id, rangeFact.id],
      });
    }
  }

  return facts;
}
