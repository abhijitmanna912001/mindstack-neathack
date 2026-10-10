// Fake SignalScout pipeline that only exists to produce a Neatlogs trace.
// Uses the synthetic fixtures: no network calls except the Neatlogs export,
// and no model calls. Run: npx tsx scripts/hello-trace.ts

import { span, trace } from "neatlogs";
import { FixtureProvider } from "../src/core/data/fixture-provider";
import { validateCompanies } from "../src/core/data/validation";
import { closeTracing, initTracing } from "../src/core/observability/tracing";
import { DEV_RUN_CONFIG, type RawCompany, type Validation } from "../src/core/types";

const provider = new FixtureProvider({ config: DEV_RUN_CONFIG });

const search = span({ kind: "TOOL", name: "search" }, async () => {
  const result = await provider.searchCompanies(
    { country: "", industries: [], employee_count_ranges: [] },
    DEV_RUN_CONFIG.max_search_results,
  );
  if (!result.ok) throw new Error(`search failed: ${result.error.category}`);
  return result.data;
});

const validate = span(
  { kind: "GUARDRAIL", name: "validate" },
  async (companies: readonly RawCompany[]) =>
    trace({ name: "validate_companies", kind: "GUARDRAIL" }, async (activeSpan) => {
      const validations = validateCompanies(companies);
      const count = (status: Validation["status"]) =>
        validations.filter((v) => v.status === status).length;
      const issueCodes = [
        ...new Set(validations.flatMap((v) => v.issues.map((i) => i.code))),
      ].sort();
      activeSpan.setAttribute("validation.valid_count", count("valid"));
      activeSpan.setAttribute("validation.flagged_count", count("flagged"));
      activeSpan.setAttribute("validation.rejected_count", count("rejected"));
      activeSpan.setAttribute("validation.issue_codes", issueCodes);
      return validations;
    }),
);

const enrich = span(
  { kind: "TOOL", name: "enrich" },
  async (companies: readonly RawCompany[]) => {
    const urls = companies
      .map((c) => c.professional_network_url)
      .filter((u) => u !== "")
      .slice(0, DEV_RUN_CONFIG.max_enrichments);
    const result = await provider.enrichCompanies(urls);
    if (!result.ok) throw new Error(`enrich failed: ${result.error.category}`);
    return result.data;
  },
);

// Stubbed: no model call. Gives every company the same placeholder score.
const score = span(
  { kind: "AGENT", name: "score" },
  async (companies: readonly RawCompany[]) =>
    companies.map((c) => ({ crustdata_company_id: c.crustdata_company_id, score: 0 })),
);

const run = span({ kind: "WORKFLOW", name: "signalscout_run" }, async () => {
  const found = await search();
  const validations = await validate(found);
  // Only records that survived validation go on to paid enrichment.
  const usable = found.filter((_, i) => validations[i].status !== "rejected");
  const enriched = await enrich(usable);
  const scores = await score(enriched);
  return {
    searched: found.length,
    usable: usable.length,
    enriched: enriched.length,
    scored: scores.length,
  };
});

async function main(): Promise<void> {
  await initTracing();
  try {
    const summary = await run();
    console.log("hello-trace done:", summary);
  } finally {
    await closeTracing();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
