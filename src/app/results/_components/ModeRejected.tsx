import Link from "next/link";
import { Badge } from "./Badge";

export const LIVE_BETA_POINTER = "For the invite-only workflow, visit the Live beta page.";

// Shown when the request asked for a mode other than synthetic. Nothing was
// run: the check happens before any provider or model client is built.
export function ModeRejected({ reason }: { reason: string }) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-500/10"
    >
      <div className="flex items-center gap-2">
        <Badge tone="bad">Mode not supported</Badge>
      </div>
      <p className="text-sm text-slate-800 dark:text-slate-100">{reason}</p>
      <p className="text-sm text-slate-800 dark:text-slate-100">{LIVE_BETA_POINTER}</p>
      <p className="text-sm text-slate-700 dark:text-slate-200">No pipeline was run and no provider or model was contacted.</p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Link
          href="/results"
          className="self-start text-sm font-semibold text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300"
        >
          View the synthetic results instead
        </Link>
        <Link
          href="/live"
          className="self-start text-sm font-semibold text-indigo-700 underline-offset-4 hover:underline dark:text-indigo-300"
        >
          Open the invite-only Live beta
        </Link>
      </div>
    </section>
  );
}
