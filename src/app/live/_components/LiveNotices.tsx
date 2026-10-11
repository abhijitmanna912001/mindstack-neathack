import { Badge } from "../../results/_components/Badge";
import { SYNTHETIC_NOTICES } from "../_lib/contract";
import type { LiveMode } from "../_lib/live-results";

export const MODE_BANNER_TITLES: Readonly<Record<LiveMode, string>> = {
  synthetic: "Demo data (synthetic)",
  live: "Live Crustdata data",
};

// Says which kind of data a run's results are, above everything else.
export function ModeBanner({ mode, model }: { mode: LiveMode; model: string }) {
  const synthetic = mode === "synthetic";
  return (
    <section
      aria-labelledby="live-mode-banner"
      className={`flex flex-col gap-2 rounded-2xl border-2 p-5 ${
        synthetic
          ? "border-amber-400 bg-amber-50 dark:border-amber-400/60 dark:bg-amber-500/10"
          : "border-indigo-400 bg-indigo-50 dark:border-indigo-400/60 dark:bg-indigo-500/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={synthetic ? "warn" : "info"}>{synthetic ? "Synthetic" : "Live"}</Badge>
        <h2 id="live-mode-banner" className="text-base font-semibold text-slate-900 dark:text-slate-50">
          {MODE_BANNER_TITLES[mode]}
        </h2>
      </div>
      <p className="text-sm leading-6 text-slate-800 dark:text-slate-100">
        {synthetic
          ? "These results come from synthetic fixture companies and a fake model. They are not a live result, and your search criteria were not used."
          : `These results come from Crustdata for your search, assessed by ${model}. They come from automated checks and are not a guarantee of company-data accuracy.`}
      </p>
    </section>
  );
}

// The response's notices. In synthetic mode the two standard synthetic
// notices always come first and are shown prominently, even if a response
// left them out.
export function RunNotices({ mode, notices }: { mode: LiveMode; notices: readonly string[] }) {
  const synthetic = mode === "synthetic" ? SYNTHETIC_NOTICES : [];
  const others = notices.filter((n) => !synthetic.includes(n));
  if (synthetic.length === 0 && others.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {synthetic.length > 0 && (
        <ul aria-label="Synthetic demo notices" className="flex flex-col gap-2">
          {synthetic.map((notice) => (
            <li
              key={notice}
              className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-medium text-slate-900 dark:border-amber-400 dark:bg-amber-500/10 dark:text-slate-50"
            >
              {notice}
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul aria-label="Run notices" className="flex flex-col gap-2">
          {others.map((notice) => (
            <li
              key={notice}
              className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50/60 px-3 py-2 text-sm text-slate-800 dark:border-indigo-400/60 dark:bg-indigo-500/10 dark:text-slate-100"
            >
              {notice}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The frontend-preview notice, shown until live integration is explicitly
// enabled, and the standing beta notices.
export function PreviewBanner() {
  return (
    <section
      aria-labelledby="preview-banner"
      className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-5 dark:border-amber-400/60 dark:bg-amber-500/10"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn">Frontend preview only</Badge>
        <h2 id="preview-banner" className="text-base font-semibold text-slate-900 dark:text-slate-50">
          Not connected to live execution
        </h2>
      </div>
      <p className="text-sm leading-6 text-slate-800 dark:text-slate-100">
        This page is a preview of the live beta&apos;s interface. Submitting the form does not check your invitation
        code, search any provider, call any model or spend anything. It shows a simulated response, chosen below,
        built from synthetic fixtures. Nothing shown here is a live result.
      </p>
    </section>
  );
}

export function BetaNotices() {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {[
        { title: "Invite-only beta", body: "Live runs need an invitation code from the builders." },
        { title: "Sponsored costs", body: "Provider and model costs are sponsored by the builders." },
        {
          title: "Automated checks",
          body: "Results are produced by automated checks and are not a guarantee of company-data accuracy.",
        },
      ].map((notice) => (
        <li
          key={notice.title}
          className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60"
        >
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{notice.title}</span>
          <span className="text-sm text-slate-600 dark:text-slate-300">{notice.body}</span>
        </li>
      ))}
    </ul>
  );
}
