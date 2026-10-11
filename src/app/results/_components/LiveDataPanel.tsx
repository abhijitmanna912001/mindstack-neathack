import { Panel } from "../../_components/results/Panel";
import { StatTile } from "../../_components/results/StatTile";
import type { EvidenceState, LiveDataEvidence, ValidationCounts } from "../_lib/evidence";
import { Badge } from "./Badge";

const STATUSES = ["valid", "flagged", "rejected"] as const satisfies readonly (keyof ValidationCounts)[];
const STATUS_LABELS: Record<keyof ValidationCounts, string> = {
  valid: "Valid",
  flagged: "Flagged",
  rejected: "Rejected",
};

function Pending() {
  return (
    <Panel
      title="Live-data evaluation"
      description="Baseline versus improved on real provider data."
      badge={<Badge tone="neutral">Pending</Badge>}
    >
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
        The live-data evaluation has not been published. No live-data results are shown, and the fixture results
        above are not a substitute for them.
      </p>
    </Panel>
  );
}

function Invalid({ errors }: { errors: readonly string[] }) {
  return (
    <Panel
      title="Live-data evaluation"
      description="The live-data evidence did not pass validation, so none of it is shown."
      badge={<Badge tone="bad">Invalid live-data evidence</Badge>}
    >
      <ul className="list-disc pl-5 text-sm text-slate-700 dark:text-slate-200">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </Panel>
  );
}

function Ready({ data }: { data: LiveDataEvidence }) {
  return (
    <Panel
      title="Live-data evaluation"
      description="Baseline versus improved on live provider data, as counts from the official evidence summary."
      badge={<Badge tone="info">Official live-data counts</Badge>}
    >
      <dl className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] dark:bg-slate-800/50">
        <dt className="font-medium text-slate-700 dark:text-slate-200">Data source</dt>
        <dd className="text-slate-900 dark:text-slate-100">{data.source}</dd>
        <dt className="font-medium text-slate-700 dark:text-slate-200">Evaluation slice</dt>
        <dd className="text-slate-900 dark:text-slate-100">{data.slice}</dd>
      </dl>

      {data.source_states_no_real_model && (
        <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-slate-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-slate-100">
          This run used live provider data with the fake model: no model calls were made and tracing was disabled.
          It evaluates data handling, not model output.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Searched" value={String(data.searched)} />
        <StatTile label="Enriched in both pipelines" value={String(data.enriched_in_both_pipelines)} />
        <StatTile
          label="Measured provider cost per run"
          value={`$${data.provider_cost_usd_measured_per_run}`}
          hint="Measured, not simulated"
        />
      </div>

      <section aria-labelledby="live-validation" className="flex flex-col gap-3">
        <h4 id="live-validation" className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Validation results
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                <th scope="col" className="py-2 pr-4 font-medium">Search stage</th>
                <th scope="col" className="py-2 font-medium">After enrichment</th>
              </tr>
            </thead>
            <tbody>
              {STATUSES.map((status) => (
                <tr key={status} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  <th scope="row" className="py-2 pr-4 text-left font-normal text-slate-700 dark:text-slate-200">
                    {STATUS_LABELS[status]}
                  </th>
                  <td className="py-2 pr-4 tabular-nums text-slate-900 dark:text-slate-100">
                    {data.search_stage_validation[status]}
                  </td>
                  <td className="py-2 tabular-nums text-slate-900 dark:text-slate-100">
                    {data.after_enrichment_validation[status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside
          aria-label="Caveat on the flagged results"
          className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm leading-6 text-slate-800 dark:border-amber-400/60 dark:bg-amber-500/10 dark:text-slate-100"
        >
          <span className="font-semibold">Caveat: </span>
          {data.caveat}
        </aside>
      </section>

      <dl className="grid gap-2 text-sm sm:grid-cols-[16rem_minmax(0,1fr)]">
        <dt className="text-slate-700 dark:text-slate-200">Changed by enrichment: valid → flagged</dt>
        <dd className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{data.valid_to_flagged}</dd>
        <dt className="text-slate-700 dark:text-slate-200">Rules fired</dt>
        <dd className="text-slate-900 dark:text-slate-100">
          {data.rules_fired.length === 0 ? (
            "None"
          ) : (
            <ul className="flex flex-col gap-1">
              {data.rules_fired.map((rule) => (
                <li key={rule.code} className="flex flex-wrap items-baseline gap-2">
                  <code className="font-mono text-xs text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">
                    {rule.code}
                  </code>
                  <span className="font-semibold tabular-nums">{rule.count}</span>
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt className="text-slate-700 dark:text-slate-200">Baseline revalidates after enrichment</dt>
        <dd className="font-semibold text-slate-900 dark:text-slate-100">
          {data.baseline_revalidates_after_enrichment ? "Yes" : "No"}
        </dd>
        <dt className="text-slate-700 dark:text-slate-200">Improved pipeline assessed</dt>
        <dd className="text-slate-900 dark:text-slate-100">
          <span className="font-semibold tabular-nums">{data.improved_assessed.valid}</span> valid,{" "}
          <span className="font-semibold tabular-nums">{data.improved_assessed.flagged}</span> flagged
        </dd>
      </dl>
    </Panel>
  );
}

// Live-data (real Crustdata) evaluation from evidence/summary.json's
// real_data. Fixture figures are never shown here.
export function LiveDataPanel({ state }: { state: EvidenceState }) {
  if (state.state !== "ready" || state.live_data.state === "pending") return <Pending />;
  if (state.live_data.state === "invalid") return <Invalid errors={state.live_data.errors} />;
  return <Ready data={state.live_data.data} />;
}
