import { Panel } from "../../_components/results/Panel";
import type { IdCountDto, MetricsDto } from "../_lib/presentation";

function Row({ label, value, ids }: { label: string; value: IdCountDto | number; ids?: readonly number[] }) {
  const count = typeof value === "number" ? value : value.count;
  const companyIds = typeof value === "number" ? ids : value.company_ids;
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4 dark:border-slate-800/60">
      <dt className="text-sm text-slate-700 dark:text-slate-200">{label}</dt>
      <dd className="flex items-baseline gap-2 sm:justify-end">
        <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{count}</span>
        {companyIds && companyIds.length > 0 && (
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">[{companyIds.join(", ")}]</span>
        )}
      </dd>
    </div>
  );
}

export function MetricsPanel({
  metrics,
  title = "Demo run guardrail metrics",
  description = "Counts and company IDs the improved pipeline reported for this demonstration run.",
}: {
  metrics: MetricsDto | null;
  title?: string;
  description?: string;
}) {
  return (
    <Panel title={title} description={description}>
      {metrics ? (
        <dl>
          <Row label="Rejected by validation" value={metrics.rejected} />
          <Row label="Duplicates removed" value={metrics.duplicates_removed} />
          <Row label="Flagged (usable, suspicious)" value={metrics.flagged} />
          <Row label="Eligible for enrichment" value={metrics.enrichment_eligible} />
          <Row label="Enrichments requested (in order sent)" value={metrics.enrichment_requested} />
          <Row label="Enriched" value={metrics.enrichment_enriched} />
          <Row label="Assessments failed" value={metrics.assessments_failed} />
          <Row label="Outreach suppressed" value={metrics.outreach_suppressed} />
          <Row label="Claim violations" value={metrics.claim_violations} />
          {metrics.claim_violations_by_code.map((c) => (
            <Row key={c.code} label={`  • ${c.code}`} value={c.count} />
          ))}
        </dl>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">The run stopped before validation; no metrics.</p>
      )}
    </Panel>
  );
}
