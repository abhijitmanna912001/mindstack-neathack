import type { FactDto } from "../_lib/presentation";
import { Badge } from "./Badge";
import { factStatusTone } from "./labels";

// Evidence facts built by buildFacts(). Claims (including any URLs) are shown
// as plain text: the data is synthetic and nothing here is a link.
export function FactsTable({ facts }: { facts: readonly FactDto[] }) {
  if (facts.length === 0) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-300">
        No facts: rejected records get no evidence.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <th scope="col" className="py-2 pr-3 font-medium">Fact ID</th>
            <th scope="col" className="py-2 pr-3 font-medium">Claim</th>
            <th scope="col" className="py-2 pr-3 font-medium">Status</th>
            <th scope="col" className="py-2 pr-3 font-medium">Source</th>
            <th scope="col" className="py-2 font-medium">Citeable</th>
          </tr>
        </thead>
        <tbody>
          {facts.map((f) => (
            <tr key={f.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800/60">
              <td className="py-2 pr-3 font-mono text-xs text-slate-600 dark:text-slate-300">{f.id}</td>
              <td className="py-2 pr-3 text-slate-800 [overflow-wrap:anywhere] dark:text-slate-100">{f.claim}</td>
              <td className="py-2 pr-3">
                <Badge tone={factStatusTone(f.status)}>{f.status.replace(/_/g, " ")}</Badge>
              </td>
              <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{f.provider}</td>
              <td className="py-2">
                <Badge tone={f.citeable ? "good" : "neutral"}>{f.citeable ? "Yes" : "No"}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
