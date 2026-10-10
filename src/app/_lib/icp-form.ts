// UI-local model for the ICP form. This is deliberately not the shared data
// contract: once src/core/types.ts is agreed, the accepted IcpDraft gets mapped
// onto it before anything is handed to the agent pipeline.

export const COMPANY_SIZE_OPTIONS = [
  { value: "1-10", label: "1–10 employees" },
  { value: "11-50", label: "11–50 employees" },
  { value: "51-200", label: "51–200 employees" },
  { value: "201-500", label: "201–500 employees" },
  { value: "501-1000", label: "501–1,000 employees" },
  { value: "1001-5000", label: "1,001–5,000 employees" },
  { value: "5001+", label: "5,001+ employees" },
] as const;

export type CompanySize = (typeof COMPANY_SIZE_OPTIONS)[number]["value"];

export const INDUSTRY_SUGGESTIONS = [
  "Software / SaaS",
  "Fintech",
  "Cybersecurity",
  "Healthcare technology",
  "E-commerce",
  "Logistics and supply chain",
  "Marketing technology",
  "Manufacturing",
];

export const ICP_LIMITS = {
  industryMaxLength: 120,
  maxLocations: 10,
  maxKeywords: 15,
  maxExcludedDomains: 50,
} as const;

export type IcpFormValues = {
  industry: string;
  companySize: string;
  location: string;
  keywords: string;
  excludedDomains: string;
  mode: string;
};

export type IcpField = keyof IcpFormValues;

export type IcpFieldErrors = Partial<Record<IcpField, string>>;

export type IcpDraft = {
  industry: string;
  companySize: CompanySize;
  locations: string[];
  keywords: string[];
  excludedDomains: string[];
  // Live Crustdata mode is not available until server-side access control exists.
  mode: "synthetic";
};

export type IcpFormState =
  | { status: "idle"; values: IcpFormValues }
  | {
      status: "invalid";
      values: IcpFormValues;
      errors: IcpFieldErrors;
      message: string;
    }
  | { status: "accepted"; values: IcpFormValues; icp: IcpDraft };

export const EMPTY_ICP_FORM: IcpFormValues = {
  industry: "",
  companySize: "",
  location: "",
  keywords: "",
  excludedDomains: "",
  mode: "synthetic",
};

export const INITIAL_ICP_FORM_STATE: IcpFormState = {
  status: "idle",
  values: EMPTY_ICP_FORM,
};

const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function readString(formData: FormData, name: IcpField): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function readIcpFormValues(formData: FormData): IcpFormValues {
  return {
    industry: readString(formData, "industry"),
    companySize: readString(formData, "companySize"),
    location: readString(formData, "location"),
    keywords: readString(formData, "keywords"),
    excludedDomains: readString(formData, "excludedDomains"),
    mode: readString(formData, "mode"),
  };
}

// Splits comma- or newline-separated input and drops blanks and
// case-insensitive duplicates, keeping the first spelling.
export function splitList(raw: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const item = part.trim();
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

// Accepts pasted URLs as well as bare domains: "https://www.Acme.com/about"
// becomes "acme.com".
export function normalizeDomain(raw: string): string {
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .split(/[/?#]/)[0];
  return host.replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
}

export function validateIcpForm(
  values: IcpFormValues,
): { ok: true; icp: IcpDraft } | { ok: false; errors: IcpFieldErrors } {
  const errors: IcpFieldErrors = {};

  if (!values.industry) {
    errors.industry = "Enter a target industry.";
  } else if (values.industry.length > ICP_LIMITS.industryMaxLength) {
    errors.industry = `Keep the industry under ${ICP_LIMITS.industryMaxLength} characters.`;
  }

  const size = COMPANY_SIZE_OPTIONS.find(
    (option) => option.value === values.companySize,
  );
  if (!size) {
    errors.companySize = "Choose a company size.";
  }

  const locations = splitList(values.location);
  if (locations.length > ICP_LIMITS.maxLocations) {
    errors.location = `Use at most ${ICP_LIMITS.maxLocations} locations.`;
  }

  const keywords = splitList(values.keywords);
  if (keywords.length > ICP_LIMITS.maxKeywords) {
    errors.keywords = `Use at most ${ICP_LIMITS.maxKeywords} keywords.`;
  }

  const excludedDomains = [
    ...new Set(splitList(values.excludedDomains).map(normalizeDomain)),
  ].filter(Boolean);
  const invalidDomains = excludedDomains.filter(
    (domain) => !DOMAIN_PATTERN.test(domain),
  );
  if (invalidDomains.length > 0) {
    errors.excludedDomains = `Not a valid domain: ${invalidDomains.slice(0, 3).join(", ")}${invalidDomains.length > 3 ? "…" : ""}`;
  } else if (excludedDomains.length > ICP_LIMITS.maxExcludedDomains) {
    errors.excludedDomains = `Use at most ${ICP_LIMITS.maxExcludedDomains} excluded domains.`;
  }

  if (values.mode !== "synthetic") {
    errors.mode = "Live Crustdata mode is not available yet. Use synthetic data.";
  }

  if (!size || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    icp: {
      industry: values.industry,
      companySize: size.value,
      locations,
      keywords,
      excludedDomains,
      mode: "synthetic",
    },
  };
}

export function companySizeLabel(size: CompanySize): string {
  return (
    COMPANY_SIZE_OPTIONS.find((option) => option.value === size)?.label ?? size
  );
}
