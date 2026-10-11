import { Badge } from "./Badge";

// Labels the page's own synthetic run, so it is never mistaken for the
// official fixture evidence.
export function DemoNotice({ companyId }: { companyId: number }) {
  return (
    <section
      aria-labelledby="demo-notice"
      className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn">Synthetic demonstration</Badge>
        <h2 id="demo-notice" className="text-base font-semibold text-slate-900 dark:text-slate-50">
          Guardrail demonstration, not an official evaluation run
        </h2>
      </div>
      <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
        This page runs the real improved pipeline on the server over the synthetic fixture companies, with a
        deterministic fake model. No external provider or model is called.
      </p>
      <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">
        To show the guards working, the fake model deliberately injects an unsupported numerical claim into company{" "}
        {companyId}&apos;s outreach. The pipeline&apos;s actual claim check finds it and suppresses that outreach. The
        injected claim and its suppression belong to this demonstration only: they are not part of the official
        fixture evidence above.
      </p>
    </section>
  );
}
