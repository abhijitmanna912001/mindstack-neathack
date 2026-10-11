import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { DemoNotice } from "./_components/DemoNotice";
import { LiveDataPanel } from "./_components/LiveDataPanel";
import { MetricsPanel } from "./_components/MetricsPanel";
import { ModeRejected } from "./_components/ModeRejected";
import { OfficialEvidencePanel } from "./_components/OfficialEvidencePanel";
import { ProspectCard } from "./_components/ProspectCard";
import { RunSummary } from "./_components/RunSummary";
import { DEMO_UNSUPPORTED_NUMBER_COMPANY_ID } from "./_lib/guardrail-demo";
import { parseRequestedMode } from "./_lib/mode";
import { loadEvidence, loadResults } from "./_lib/server";

export const metadata: Metadata = {
  title: "Results",
  description:
    "Official SignalScout fixture evidence, baseline versus improved, and a separate synthetic guardrail demonstration.",
};

type ResultsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex max-w-3xl flex-col gap-2">
        <Link href="/" className="text-sm font-medium text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300">
          ← Back to the prospect workspace
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
          Pipeline results
        </h1>
      </div>
      {children}
    </main>
  );
}

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const { mode } = await searchParams;

  // Checked here and again inside the loader: an unsupported mode never
  // reaches dependency construction or the pipeline.
  const check = parseRequestedMode(mode);
  if (!check.ok) {
    return (
      <PageShell>
        <ModeRejected reason={check.reason} />
      </PageShell>
    );
  }
  const loaded = await loadResults(mode);
  if (loaded.kind === "rejected") {
    return (
      <PageShell>
        <ModeRejected reason={loaded.reason} />
      </PageShell>
    );
  }
  const { results } = loaded;
  const evidence = loadEvidence();

  return (
    <PageShell>
      <OfficialEvidencePanel state={evidence} />
      <LiveDataPanel state={evidence} />

      <div className="flex flex-col gap-1 border-t border-slate-200 pt-8 dark:border-slate-800">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          Synthetic guardrail demonstration
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          A separate run made by this page. It is not one of the official evidence runs.
        </p>
      </div>
      <DemoNotice companyId={DEMO_UNSUPPORTED_NUMBER_COMPANY_ID} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <RunSummary results={results} />
        <MetricsPanel metrics={results.metrics} />
      </div>

      {results.issues.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-slate-100">
          <h2 className="mb-2 font-semibold">Run notes</h2>
          <ul className="list-disc pl-5">
            {results.issues.map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="prospects-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="prospects-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Demonstration prospects ({results.prospects.length})
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">In search order. Rejected records stay listed with the reason.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {results.prospects.map((p) => (
            <ProspectCard key={p.company_id} prospect={p} />
          ))}
        </div>
      </section>
    </PageShell>
  );
}
