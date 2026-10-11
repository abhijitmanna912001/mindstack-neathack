import { Panel } from "../../_components/results/Panel";
import {
  EVIDENCE_METRICS,
  type EvidenceState,
  type MetricGroup,
  METRIC_GROUP_LABELS,
  type MetricUnit,
} from "../_lib/evidence";
import { Badge } from "./Badge";

// Values exactly as the evidence file states them: no rounding, no
// derivation. A metric a run does not report is shown as "not reported".
function formatValue(value: number | undefined, unit: MetricUnit): string {
  if (value === undefined) return "not reported";
  return unit === "usd" ? `$${value}` : String(value);
}

const GROUPS: readonly MetricGroup[] = ["enrichment", "assessment", "outreach", "model", "provider"];

// Official baseline-versus-improved results on the synthetic fixtures, from
// evidence/summary.json.
export function OfficialEvidencePanel({ state }: { state: EvidenceState }) {
  if (state.state === "invalid") {
    return (
      <Panel
        title="Official fixture evidence"
        description="The evidence summary did not pass validation, so no figures are shown."
        badge={<Badge tone="bad">Invalid evidence file</Badge>}
      >
        <ul className="list-disc pl-5 text-sm text-slate-700 dark:text-slate-200">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Panel>
    );
  }

  const { summary } = state;
  return (
    <Panel
      title="Official fixture evidence"
      description={summary.scenario}
      badge={<Badge tone="good">Official runs</Badge>}
    >
      <p className="text-xs text-slate-600 dark:text-slate-300">
        Source reports: {summary.source_reports.join(", ")}. Figures are shown exactly as recorded in the official
        evidence summary.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
              <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
              <th scope="col" className="py-2 pr-4 font-medium">Baseline</th>
              <th scope="col" className="py-2 font-medium">Improved</th>
            </tr>
          </thead>
          {GROUPS.map((group) => {
            const rows = EVIDENCE_METRICS.filter(
              (m) => m.group === group && (summary.baseline[m.key] !== undefined || summary.improved[m.key] !== undefined),
            );
            if (rows.length === 0) return null;
            return (
              <tbody key={group}>
                <tr>
                  <th
                    scope="rowgroup"
                    colSpan={3}
                    className="pb-1 pt-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
                  >
                    {METRIC_GROUP_LABELS[group]}
                  </th>
                </tr>
                {rows.map((m) => (
                  <tr key={m.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                    <th scope="row" className="py-2 pr-4 text-left font-normal text-slate-700 dark:text-slate-200">
                      {m.label}
                    </th>
                    <td className="py-2 pr-4 tabular-nums text-slate-900 dark:text-slate-100">
                      {formatValue(summary.baseline[m.key], m.unit)}
                    </td>
                    <td className="py-2 tabular-nums text-slate-900 dark:text-slate-100">
                      {formatValue(summary.improved[m.key], m.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>

      <dl className="grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-[13rem_minmax(0,1fr)] dark:bg-slate-800/50">
        <dt className="font-medium text-slate-700 dark:text-slate-200">Assessed vs delivered</dt>
        <dd className="text-slate-800 dark:text-slate-100">
          &ldquo;Assessed&rdquo; counts prospects that received an assessment and have a score. &ldquo;Delivered&rdquo;
          counts eligible prospects, those not rejected by validation. The official summary does not report delivered
          counts, so none are shown here.
        </dd>
        <dt className="font-medium text-slate-700 dark:text-slate-200">Recorded model cost</dt>
        <dd className="text-slate-800 dark:text-slate-100">The model cost each official run recorded for its model calls.</dd>
        <dt className="font-medium text-slate-700 dark:text-slate-200">Simulated provider cost</dt>
        <dd className="text-slate-800 dark:text-slate-100">
          Not charged: {summary.provider_cost_basis}. The runs used synthetic fixtures, not live provider data.
        </dd>
      </dl>

      {summary.notes.length > 0 && (
        <section aria-label="Official notes" className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Official notes
          </h4>
          <ul className="flex flex-col gap-2">
            {summary.notes.map((note) => (
              <li
                key={note}
                className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50/60 px-3 py-2 text-sm leading-6 text-slate-800 dark:border-indigo-400/60 dark:bg-indigo-500/10 dark:text-slate-100"
              >
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Panel>
  );
}
