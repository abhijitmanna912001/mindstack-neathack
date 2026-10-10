// Synthetic companies for tests and demos. Every name, domain and URL here is
// invented; none refers to a real firm.

import type { RawCompany } from "../types";

const base = {
  source: "enrich",
  retrieved_at: "2026-01-15T09:00:00Z",
  cost_usd: 0.05,
  logo: "",
} as const;

export const FIXTURE_COMPANIES: readonly RawCompany[] = [
  // 1. Clean record.
  {
    ...base,
    crustdata_company_id: 1001,
    name: "Brightwater Labs",
    primary_domain: "brightwaterlabs.example",
    website: "https://www.brightwaterlabs.example",
    professional_network_url: "https://www.linkedin.com/company/brightwater-labs",
    employee_count_range: "51-200",
    industry: "Software",
    latest_headcount: 120,
    revenue_range: "$10M-$50M",
  },
  // 2. Missing name and domain, but has a LinkedIn URL.
  {
    ...base,
    crustdata_company_id: 1002,
    name: "",
    primary_domain: "",
    website: "",
    professional_network_url: "https://www.linkedin.com/company/quietpine",
    employee_count_range: "11-50",
    industry: "Consulting",
  },
  // 3. Website is a wa.link messaging link.
  {
    ...base,
    crustdata_company_id: 1003,
    name: "Corner Bakery Collective",
    primary_domain: "cornerbakerycollective.example",
    website: "https://wa.link/abc123",
    professional_network_url: "https://www.linkedin.com/company/corner-bakery-collective",
    employee_count_range: "1-10",
    industry: "Food & Beverage",
  },
  // 4. First of two records sharing a domain (kept).
  {
    ...base,
    crustdata_company_id: 1004,
    name: "Northfield Analytics",
    primary_domain: "northfieldanalytics.example",
    website: "https://northfieldanalytics.example",
    professional_network_url: "https://www.linkedin.com/company/northfield-analytics",
    employee_count_range: "11-50",
    industry: "Data",
  },
  // 5. Second record sharing the domain (later duplicate, rejected).
  {
    ...base,
    crustdata_company_id: 1005,
    name: "Northfield Analytics Ltd",
    primary_domain: "NorthfieldAnalytics.example/",
    website: "http://www.northfieldanalytics.example/about",
    professional_network_url: "https://www.linkedin.com/company/northfield-analytics-ltd",
    employee_count_range: "11-50",
    industry: "Data",
  },
  // 6. No domain, but a website.
  {
    ...base,
    crustdata_company_id: 1006,
    name: "Sunvale Orchards",
    primary_domain: "",
    website: "https://sunvaleorchards.example",
    professional_network_url: "https://www.linkedin.com/company/sunvale-orchards",
    employee_count_range: "51-200",
    industry: "Agriculture",
  },
  // 7. Messy long name.
  {
    ...base,
    crustdata_company_id: 1007,
    name: "  ZENITH-PEAK   Global Solutions & Trading Private Limited (Formerly Known As Zenith Peak Traders)  - Official Page ™  ",
    primary_domain: "zenithpeak.example",
    website: "https://zenithpeak.example",
    professional_network_url: "https://www.linkedin.com/company/zenith-peak",
    employee_count_range: "201-500",
    industry: "Trading",
    latest_headcount: 300,
  },
  // 8. Headcount outside its range.
  {
    ...base,
    crustdata_company_id: 1008,
    name: "Tidewell Logistics",
    primary_domain: "tidewelllogistics.example",
    website: "https://tidewelllogistics.example",
    professional_network_url: "https://www.linkedin.com/company/tidewell-logistics",
    employee_count_range: "11-50",
    industry: "Logistics",
    latest_headcount: 640,
  },
  // 9. Implausible revenue per employee ($10M floor / 4 people).
  {
    ...base,
    crustdata_company_id: 1009,
    name: "Pocket Rocket Studio",
    primary_domain: "pocketrocketstudio.example",
    website: "https://pocketrocketstudio.example",
    professional_network_url: "https://www.linkedin.com/company/pocket-rocket-studio",
    employee_count_range: "1-10",
    industry: "Design",
    latest_headcount: 4,
    revenue_range: "$10M-$50M",
  },
  // 10. Nothing identifying.
  {
    ...base,
    crustdata_company_id: 1010,
    name: "",
    primary_domain: "",
    website: "",
    professional_network_url: "",
    employee_count_range: "",
    industry: "",
  },
];
