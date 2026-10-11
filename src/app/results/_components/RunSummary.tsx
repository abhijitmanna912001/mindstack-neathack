import { Panel } from "../../_components/results/Panel";
import { StatTile } from "../../_components/results/StatTile";
import type { ResultsDto } from "../_lib/presentation";
import { Badge } from "./Badge";

const usd = (n: number) => `$${n.toFixed(2)}`;

// run.counts.assessed: prospects whose assessment succeeded and carries a fit
// score (failed or skipped assessments are excluded).
export const ASSESSED_HINT = "Received an assessment with a fit score";
// run.counts.delivered: the pipeline's eligible prospects, i.e. every company
// whose final validation status is not "rejected". It does not depend on
// enrichment, assessment or outreach.
export const DELIVERED_HINT = "Eligible: not rejected by validation (valid or flagged)";
// metrics.enrichment.eligible: not rejected at search and has a LinkedIn URL.
export const ENRICHMENT_ELIGIBLE_HINT = "Not rejected, with a LinkedIn URL";

export function RunSummary({ results }: { results: ResultsDto }) {
  const { run, metrics } = results;
  return (
    <Panel
      title="Demo run summary"
      description={`Synthetic demonstration run of the improved pipeline, status: ${run.status}. Limits: ${run.limits.max_search_results} searched, ${run.limits.max_enrichments} enrichments, ${run.limits.max_llm_calls_per_run} model calls.`}
      badge={<Badge tone="info">Synthetic mode</Badge>}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Companies searched" value={String(run.counts.searched)} />
        <StatTile
          label="Eligible for enrichment"
          value={metrics ? String(metrics.enrichment_eligible.count) : "—"}
          hint={ENRICHMENT_ELIGIBLE_HINT}
        />
        <StatTile label="Enrichments requested" value={metrics ? String(metrics.enrichment_requested.count) : "—"} />
        <StatTile label="Enriched" value={String(run.counts.enriched)} />
        <StatTile label="Assessed" value={String(run.counts.assessed)} hint={ASSESSED_HINT} />
        <StatTile label="Delivered (eligible)" value={String(run.counts.delivered)} hint={DELIVERED_HINT} />
        <StatTile label="Fake-model calls" value={String(run.counts.model_calls)} />
      </div>
      <dl className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] dark:bg-slate-800/50">
        <dt className="font-medium text-slate-700 dark:text-slate-200">Actual spend</dt>
        <dd className="text-slate-900 dark:text-slate-100">
          {usd(run.actual_spend_usd)}: no external provider or model was called.
        </dd>
        <dt className="font-medium text-slate-700 dark:text-slate-200">Simulated provider cost</dt>
        <dd className="text-slate-900 dark:text-slate-100">
          {usd(run.simulated_provider_cost_usd.total)} (search {usd(run.simulated_provider_cost_usd.search)}, enrichment{" "}
          {usd(run.simulated_provider_cost_usd.enrich)}). Synthetic per-record prices set on the fixture provider, not a
          charge.
        </dd>
        <dt className="font-medium text-slate-700 dark:text-slate-200">Model</dt>
        <dd className="text-slate-900 dark:text-slate-100">
          Deterministic fake model in this app; no model was called and nothing was billed.
        </dd>
        <dt className="font-medium text-slate-700 dark:text-slate-200">Fact provenance</dt>
        <dd className="text-slate-900 dark:text-slate-100">{run.fact_provider} (synthetic fixtures)</dd>
      </dl>
    </Panel>
  );
}
