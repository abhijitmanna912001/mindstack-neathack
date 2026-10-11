import type { FindingDto } from "../_lib/presentation";
import { Badge } from "./Badge";

// Findings exactly as validateAssessment() / checkClaims() reported them.
export function FindingsList({ findings }: { findings: readonly FindingDto[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((f, i) => (
        <li key={`${f.code}-${f.fact_id ?? ""}-${i}`} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:gap-2">
          <Badge tone={f.severity === "error" ? "bad" : "warn"}>{f.severity}</Badge>
          <span className="min-w-0 text-slate-700 dark:text-slate-200">
            <code className="mr-1.5 font-mono text-xs text-slate-500 dark:text-slate-400">{f.code}</code>
            {f.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
