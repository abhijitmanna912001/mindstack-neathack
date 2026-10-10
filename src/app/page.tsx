import { ProspectWorkspace } from "./_components/ProspectWorkspace";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
          Find and qualify B2B prospects
        </h1>
        <p className="text-sm leading-6 text-slate-600 sm:text-base dark:text-slate-400">
          Describe your ideal customer, then review scored companies, the
          evidence behind each score, budget usage and draft outreach in one
          place.
        </p>
      </div>
      <ProspectWorkspace />
    </main>
  );
}
