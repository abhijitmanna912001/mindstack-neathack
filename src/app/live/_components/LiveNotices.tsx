import { Badge } from "../../results/_components/Badge";

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
