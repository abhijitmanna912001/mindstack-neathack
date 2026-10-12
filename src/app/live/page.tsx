import type { Metadata } from "next";
import Link from "next/link";
import { BetaNotices, PreviewBanner } from "./_components/LiveNotices";
import { LiveRun } from "./_components/LiveRun";
import { buildPreviewFixtures } from "./_lib/fixtures";
import { isPreviewRequest } from "./_lib/preview";

export const metadata: Metadata = {
  title: "Live beta",
  description: "SignalScout's invite-only live beta: find and qualify companies in India with an invitation code.",
};

interface LivePageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// The invite-only live beta. By default the form submits to /api/live/run.
// In preview mode the synthetic fixture responses are built here on the
// server (fixtures, fake model, no network) and the form uses a local mock.
export default async function LivePage({ searchParams }: LivePageProps) {
  const preview = isPreviewRequest((await searchParams).preview);
  const previewFixtures = preview ? await buildPreviewFixtures() : undefined;
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex max-w-3xl flex-col gap-2">
        <Link href="/results" className="text-sm font-medium text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300">
          ← Back to the results
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
          Live beta{preview ? " (preview mode)" : ""}
        </h1>
        <p className="text-sm leading-6 text-slate-600 sm:text-base dark:text-slate-300">
          Find and qualify companies in India with an invitation code.
        </p>
      </div>
      {preview && <PreviewBanner />}
      <BetaNotices />
      <LiveRun previewFixtures={previewFixtures} />
      {!preview && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Want to see every possible response without a code?{" "}
          <Link href="/live?preview=1" className="font-medium text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300">
            Open preview mode
          </Link>
          .
        </p>
      )}
    </main>
  );
}
