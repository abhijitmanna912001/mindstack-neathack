import { StatTile } from "../../_components/results/StatTile";
import { Badge } from "../../results/_components/Badge";
import { ProspectCard } from "../../results/_components/ProspectCard";
import type { LiveRunSuccess } from "../_lib/contract";
import { ERROR_PRESENTATION } from "../_lib/messages";
import type { LiveViewState } from "../_lib/submission";

export interface LiveOutcomeProps {
  readonly state: LiveViewState;
  // True while the page is a frontend preview: results are labelled as
  // synthetic and never as live.
  readonly preview: boolean;
  readonly onBack: () => void;
  readonly onRetry: () => void;
}

const buttonPrimary =
  "inline-flex h-10 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";
const buttonSecondary =
  "inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";

function Results({ response, partial, preview, onBack }: { response: LiveRunSuccess; partial: boolean; preview: boolean; onBack: () => void }) {
  const { results, usage, notices } = response;
  return (
    <section aria-labelledby="live-results-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="live-results-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {partial ? "Partial results" : "Results"}
        </h2>
        {preview && <Badge tone="warn">Synthetic preview data, not a live result</Badge>}
        {partial && <Badge tone="warn">Partial</Badge>}
      </div>

      {partial && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-slate-100"
        >
          <p className="font-semibold">The run did not complete every step, so these results are incomplete.</p>
          {results.issues.length > 0 && (
            <ul className="list-disc pl-5">
              {results.issues.map((issue) => (
                <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Runs remaining" value={String(usage.runsRemaining)} />
        <StatTile label="Companies searched" value={String(usage.searched)} />
        <StatTile label="Companies enriched" value={String(usage.enriched)} />
        <StatTile
          label="Provider cost"
          value={`$${usage.providerCostUsd.toFixed(2)}`}
          hint={preview ? "Simulated, from fixture prices" : "Sponsored by the builders"}
        />
      </div>

      {notices.length > 0 && (
        <ul className="flex flex-col gap-2">
          {notices.map((notice) => (
            <li
              key={notice}
              className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50/60 px-3 py-2 text-sm text-slate-800 dark:border-indigo-400/60 dark:bg-indigo-500/10 dark:text-slate-100"
            >
              {notice}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-slate-600 dark:text-slate-300">
        Results are produced by automated checks and are not a guarantee of company-data accuracy.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        {results.prospects.map((p) => (
          <ProspectCard key={p.company_id} prospect={p} />
        ))}
      </div>

      <button type="button" onClick={onBack} className={`${buttonSecondary} self-start`}>
        Start a new search
      </button>
    </section>
  );
}

// What the page shows below the form for each state.
export function LiveOutcome({ state, preview, onBack, onRetry }: LiveOutcomeProps) {
  switch (state.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <section
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200"
        >
          <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
          <span>
            Running…{" "}
            {preview ? "This preview simulates a run; nothing is being searched." : "This can take a little while."}
          </span>
        </section>
      );
    case "error": {
      const error = ERROR_PRESENTATION[state.code];
      return (
        <section
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-500/10"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="bad">{error.title}</Badge>
            {preview && <Badge tone="warn">Simulated response</Badge>}
          </div>
          <p className="text-sm text-slate-800 dark:text-slate-100">{error.message}</p>
          <p className="text-sm text-slate-700 dark:text-slate-200">{error.recovery}</p>
          <div className="flex flex-wrap gap-2">
            {error.action === "retry" && (
              <button type="button" onClick={onRetry} className={buttonPrimary}>
                Try again
              </button>
            )}
            <button type="button" onClick={onBack} className={error.action === "retry" ? buttonSecondary : buttonPrimary}>
              {error.action === "edit" ? "Edit the form" : "Back to the form"}
            </button>
          </div>
        </section>
      );
    }
    case "success":
      return <Results response={state.response} partial={state.partial} preview={preview} onBack={onBack} />;
  }
}
