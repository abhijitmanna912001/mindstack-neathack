// Turns the user's ICP into provider SearchFilters, a plain-English
// description for the Run record, and the criteria the model scores against.

import type { CompanyProvider, SearchFilters } from "../data/provider";
import type { IcpInput, PipelineIssue } from "./types";

export interface SearchPlan {
  readonly filters: SearchFilters;
  readonly issues: readonly PipelineIssue[];
  readonly cost_usd: number;
  readonly calls: number;
}

// Free text like "software" becomes the provider's own labels via the free
// autocomplete call. If autocomplete fails, the raw text is searched as-is.
export async function buildSearchFilters(
  icp: IcpInput,
  provider: CompanyProvider,
): Promise<SearchPlan> {
  const issues: PipelineIssue[] = [];
  let industries: readonly string[] = [];
  let cost_usd = 0;
  let calls = 0;

  const industry = icp.industry.trim();
  if (industry !== "") {
    const result = await provider.autocompleteIndustry(industry);
    if (result.ok) {
      industries = result.data;
      cost_usd += result.cost_usd;
      calls += result.calls;
    } else {
      industries = [industry];
      issues.push(
        result.error.category === "no_match"
          ? {
              step: "plan",
              code: "industry_not_recognised",
              message: `No provider industry matches "${industry}"; searching the text as given.`,
              error_category: "no_match",
            }
          : {
              step: "plan",
              code: "industry_autocomplete_failed",
              message: `Industry autocomplete failed (${result.error.message}); searching "${industry}" as given.`,
              error_category: result.error.category,
            },
      );
    }
  }

  const locations = icp.locations.map((l) => l.trim()).filter((l) => l !== "");
  if (locations.length > 1) {
    issues.push({
      step: "plan",
      code: "extra_locations_ignored",
      message: `Search takes one country; using "${locations[0]}" and ignoring ${locations.slice(1).join(", ")}.`,
    });
  }

  return {
    filters: {
      country: locations[0] ?? "",
      industries,
      employee_count_ranges: icp.employee_count_ranges,
    },
    issues,
    cost_usd,
    calls,
  };
}

export function describeIcp(icp: IcpInput): string {
  const parts = [
    `Companies in ${icp.industry.trim() || "any industry"}`,
    icp.employee_count_ranges.length > 0
      ? `with ${icp.employee_count_ranges.join(" or ")} employees`
      : "of any size",
    icp.locations.length > 0 ? `located in ${icp.locations.join(", ")}` : "in any location",
  ];
  let text = parts.join(" ");
  if (icp.keywords.length > 0) text += `, matching: ${icp.keywords.join(", ")}`;
  if (icp.excluded_domains.length > 0) {
    text += `, excluding: ${icp.excluded_domains.join(", ")}`;
  }
  return `${text}.`;
}

// One criterion per part of the ICP the user actually filled in.
export function assessmentCriteria(icp: IcpInput): readonly string[] {
  const criteria: string[] = [];
  if (icp.industry.trim() !== "") criteria.push(`Industry: ${icp.industry.trim()}`);
  if (icp.employee_count_ranges.length > 0) {
    criteria.push(`Company size: ${icp.employee_count_ranges.join(" or ")} employees`);
  }
  if (icp.locations.length > 0) criteria.push(`Location: ${icp.locations.join(", ")}`);
  if (icp.keywords.length > 0) criteria.push(`Keywords: ${icp.keywords.join(", ")}`);
  return criteria;
}
