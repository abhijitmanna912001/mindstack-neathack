import type { FactDto, OutreachDto } from "../_lib/presentation";
import { Badge } from "./Badge";
import { FindingsList } from "./FindingsList";

export function OutreachBlock({ outreach, facts }: { outreach: OutreachDto; facts: readonly FactDto[] }) {
  if (outreach.state === "none") {
    return <p className="text-sm text-slate-600 dark:text-slate-300">No outreach draft.</p>;
  }

  if (outreach.state === "suppressed") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50/60 p-3 dark:border-red-500/30 dark:bg-red-500/5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="bad">Outreach suppressed</Badge>
          <span className="text-sm text-slate-700 dark:text-slate-200">
            The draft was removed by the claim check. The findings below come from the pipeline.
          </span>
        </div>
        <FindingsList findings={outreach.findings} />
      </div>
    );
  }

  const byId = new Map(facts.map((f) => [f.id, f]));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/5">
      <div className="flex items-center gap-2">
        <Badge tone="good">Outreach kept</Badge>
        <span className="text-sm text-slate-700 dark:text-slate-200">Passed the claim check.</span>
      </div>
      <p className="whitespace-pre-line text-sm leading-6 text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{outreach.body}</p>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Cited facts</span>
        <ul className="flex flex-col gap-1">
          {outreach.cited_fact_ids.map((id) => {
            const fact = byId.get(id);
            return (
              <li key={id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <code className="font-mono text-xs text-slate-600 dark:text-slate-300">{id}</code>
                <span className="min-w-0 text-slate-800 [overflow-wrap:anywhere] dark:text-slate-100">{fact ? fact.claim : "Not a fact for this company"}</span>
                {fact && <Badge tone={fact.citeable ? "good" : "bad"}>{fact.citeable ? "citeable" : "not citeable"}</Badge>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
