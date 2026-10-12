import Link from "next/link";
import type { IcpDraft } from "../../_lib/icp-form";
import { BudgetUsagePlaceholder } from "./BudgetUsagePlaceholder";
import { EvidencePlaceholder } from "./EvidencePlaceholder";
import { IcpSummary } from "./IcpSummary";
import { OutreachDraftsPlaceholder } from "./OutreachDraftsPlaceholder";
import { Panel } from "./Panel";
import { ProspectScoresPlaceholder } from "./ProspectScoresPlaceholder";
import { StatTile } from "./StatTile";

const LINK_CLASS =
  "font-semibold text-indigo-700 underline underline-offset-4 hover:text-indigo-600 dark:text-indigo-300";

type ResultsPanelProps = {
  icp: IcpDraft | null;
  pending: boolean;
};

function RunStatus({ icp, pending }: ResultsPanelProps) {
  if (pending) {
    return <>Checking your profile…</>;
  }
  if (icp) {
    // This page only records the profile; it never runs the pipeline.
    return (
      <>
        Profile accepted. This page does not run the pipeline, so no results
        are generated here. Run it on the{" "}
        <Link href="/live" className={LINK_CLASS}>
          Live beta page
        </Link>{" "}
        with an invitation code, or see the saved evidence on the{" "}
        <Link href="/results" className={LINK_CLASS}>
          Results page
        </Link>
        .
      </>
    );
  }
  return <>Define your ideal customer profile to start a run.</>;
}

export function ResultsPanel({ icp, pending }: ResultsPanelProps) {
  return (
    // A container, so the grids below respond to the results column's width
    // rather than the viewport's (the column is narrower beside the form).
    <section aria-labelledby="results-title" className="@container flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2
          id="results-title"
          className="text-lg font-semibold text-slate-900 dark:text-slate-100"
        >
          Results
        </h2>
        <p aria-live="polite" className="text-sm text-slate-600 dark:text-slate-300">
          <RunStatus icp={icp} pending={pending} />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
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

      <div className="grid gap-5 @2xl:grid-cols-2">
        <EvidencePlaceholder />
        <BudgetUsagePlaceholder />
      </div>

      <OutreachDraftsPlaceholder />
    </section>
  );
}
