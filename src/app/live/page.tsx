import type { Metadata } from "next";
import Link from "next/link";
import { BetaNotices, PreviewBanner } from "./_components/LiveNotices";
import { LivePreview } from "./_components/LivePreview";
import { buildPreviewFixtures } from "./_lib/fixtures";

export const metadata: Metadata = {
  title: "Live beta (preview)",
  description: "Frontend preview of SignalScout's invite-only live beta. Not connected to live execution.",
};

// Frontend preview of the invite-only live beta. The synthetic fixture
// responses are built here on the server (fixtures, fake model, no network)
// and handed to the client preview as plain DTOs.
export default async function LivePage() {
  const fixtures = await buildPreviewFixtures();
  return (
    <main className="mx-auto flex w-full max-w-page flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex max-w-3xl flex-col gap-2">
        <Link href="/results" className="text-sm font-medium text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300">
          ← Back to the results
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
          Live beta
        </h1>
        <p className="text-sm leading-6 text-slate-600 sm:text-base dark:text-slate-300">
          Find and qualify companies in India with an invitation code.
        </p>
      </div>
      <PreviewBanner />
      <BetaNotices />
      <LivePreview fixtures={fixtures} />
    </main>
  );
}
