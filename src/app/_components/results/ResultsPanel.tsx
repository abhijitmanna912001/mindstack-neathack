import type { IcpDraft } from "../../_lib/icp-form";
import { BudgetUsagePlaceholder } from "./BudgetUsagePlaceholder";
import { EvidencePlaceholder } from "./EvidencePlaceholder";
import { IcpSummary } from "./IcpSummary";
import { OutreachDraftsPlaceholder } from "./OutreachDraftsPlaceholder";
import { Panel } from "./Panel";
import { ProspectScoresPlaceholder } from "./ProspectScoresPlaceholder";
import { StatTile } from "./StatTile";

type ResultsPanelProps = {
  icp: IcpDraft | null;
  pending: boolean;
};

function RunStatus({ icp, pending }: ResultsPanelProps) {
  if (pending) {
    return <>Checking your profile…</>;
  }
  if (icp) {
    return (
      <>
        Profile accepted. The prospecting pipeline is not connected yet, so no
        results are generated.
      </>
    );
  }
  return <>Define your ideal customer profile to start a run.</>;
}

export function ResultsPanel({ icp, pending }: ResultsPanelProps) {
  return (
    <section aria-labelledby="results-title" className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2
          id="results-title"
          className="text-base font-semibold text-slate-900 dark:text-slate-100"
        >
          Results
        </h2>
        <p aria-live="polite" className="text-sm text-slate-500 dark:text-slate-400">
          <RunStatus icp={icp} pending={pending} />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Companies found" value="—" />
        <StatTile label="Qualified" value="—" />
        <StatTile label="Average fit" value="—" />
        <StatTile label="Drafts ready" value="—" />
      </div>

      {icp && (
        <Panel title="Active profile" description="The profile the next run will use.">
          <IcpSummary icp={icp} />
        </Panel>
      )}

      <ProspectScoresPlaceholder pending={pending} />

      <div className="grid gap-5 md:grid-cols-2">
        <EvidencePlaceholder />
        <BudgetUsagePlaceholder />
      </div>

      <OutreachDraftsPlaceholder />
    </section>
  );
}
