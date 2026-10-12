import { Badge } from "../../results/_components/Badge";
import { MetricsPanel } from "../../results/_components/MetricsPanel";
import { ProspectCard } from "../../results/_components/ProspectCard";
import type { LiveRunSuccess } from "../_lib/contract";
import { ERROR_PRESENTATION, invalidFieldText, retryAfterText, TIMEOUT_PRESENTATION } from "../_lib/messages";
import type { LiveViewState } from "../_lib/submission";
import { ModeBanner, RunNotices } from "./LiveNotices";
import { LiveRunSummary } from "./LiveRunSummary";

export interface LiveOutcomeProps {
  readonly state: LiveViewState;
  // True in preview mode (/live?preview=1): results are labelled as
  // synthetic preview data and never as live.
  readonly preview: boolean;
  // Seconds since the run started, shown while it is in progress.
  readonly elapsedSeconds?: number;
  readonly onBack: () => void;
  readonly onRetry: () => void;
}

const buttonPrimary =
  "inline-flex h-10 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";
const buttonSecondary =
  "inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800";

function Results({ response, partial, preview, onBack }: { response: LiveRunSuccess; partial: boolean; preview: boolean; onBack: () => void }) {
  const { results, usage, notices } = response;
  const { mode } = results.run;
  return (
    <section aria-labelledby="live-results-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="live-results-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {partial ? "Partial results" : "Results"}
        </h2>
        {preview && <Badge tone="warn">Synthetic preview data, not a live result</Badge>}
        {partial && <Badge tone="warn">Partial</Badge>}
      </div>

      <ModeBanner mode={mode} model={results.run.model} />
      <RunNotices mode={mode} notices={notices} />

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

      <p className="text-sm text-slate-700 dark:text-slate-200">
        Runs remaining on this invitation: <span className="font-semibold tabular-nums">{usage.runsRemaining}</span>
        {preview && " (a made-up preview value)"}
      </p>

      <LiveRunSummary results={results} />
      {mode === "live" ? (
        <MetricsPanel
          metrics={results.metrics}
          title="Guardrail metrics"
          description="Counts and company IDs the improved pipeline reported for this run."
        />
      ) : (
        <MetricsPanel metrics={results.metrics} />
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

// Elapsed time as m:ss.
export function elapsedText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// What the page shows below the form for each state.
export function LiveOutcome({ state, preview, elapsedSeconds = 0, onBack, onRetry }: LiveOutcomeProps) {
  switch (state.kind) {
    case "idle":
      return null;
    case "loading":
      return (
        <section
          role="status"
          aria-busy="true"
          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200"
        >
          <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600" />
          <span className="flex flex-col gap-0.5">
            <span aria-live="polite">
              Running…{" "}
              {preview
                ? "This preview simulates a run; nothing is being searched."
                : "A run can take up to a minute. Please keep this page open."}
            </span>
            <span className="tabular-nums text-slate-600 dark:text-slate-300">{elapsedText(elapsedSeconds)} elapsed</span>
          </span>
        </section>
      );
    case "timeout":
      return (
        <section
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/40 dark:bg-amber-500/10"
        >
          <Badge tone="warn">{TIMEOUT_PRESENTATION.title}</Badge>
          <p className="text-sm text-slate-800 dark:text-slate-100">{TIMEOUT_PRESENTATION.message}</p>
          <p className="text-sm text-slate-700 dark:text-slate-200">{TIMEOUT_PRESENTATION.recovery}</p>
          <div>
            <button type="button" onClick={onBack} className={buttonPrimary}>
              Back to the form
            </button>
          </div>
        </section>
      );
    case "error": {
      const error = ERROR_PRESENTATION[state.code];
      const fieldText = invalidFieldText(state.field);
      const waitText = retryAfterText(state.retryAfterSeconds);
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
          {fieldText && <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{fieldText}</p>}
          <p className="text-sm text-slate-700 dark:text-slate-200">{error.recovery}</p>
          {waitText && <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{waitText}</p>}
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
