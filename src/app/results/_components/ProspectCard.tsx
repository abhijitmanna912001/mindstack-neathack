import type { ReactNode } from "react";
import type { ProspectDto } from "../_lib/presentation";
import { Badge } from "./Badge";
import { FactsTable } from "./FactsTable";
import { FindingsList } from "./FindingsList";
import {
  enrichmentLabel,
  failedLabel,
  notAssessedLabel,
  validationLabel,
  validationTone,
} from "./labels";
import { OutreachBlock } from "./OutreachBlock";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{title}</h4>
      {children}
    </section>
  );
}

export function ProspectCard({ prospect }: { prospect: ProspectDto }) {
  const { assessment, validation } = prospect;
  const findings = [...prospect.guard.assessment_findings, ...prospect.guard.claim_findings];

  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="break-words text-[0.9375rem] font-semibold text-slate-900 dark:text-slate-100">
            {prospect.display_name}
          </h3>
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">ID {prospect.company_id}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={validationTone(validation.status)}>{validationLabel(validation.status ?? "unknown")}</Badge>
          <Badge tone={prospect.enrichment_status === "enriched" ? "info" : "neutral"}>
            {enrichmentLabel(prospect.enrichment_status)}
          </Badge>
        </div>
      </header>

      {assessment.status === "assessed" ? (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{assessment.fit_score}</span>
            <span className="text-sm text-slate-600 dark:text-slate-300">fit score</span>
          </div>
          <ul className="flex flex-wrap gap-2">
            {assessment.criterion_scores.map((c) => (
              <li key={c.criterion} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {c.criterion}: <span className="font-semibold tabular-nums">{c.score}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {assessment.status === "failed"
            ? `${failedLabel(assessment.reason)}: ${assessment.message}`
            : notAssessedLabel(assessment.reason)}
        </p>
      )}

      {validation.issues.length > 0 && (
        <Section title="Validation issues">
          <ul className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
            {validation.issues.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>
                <code className="mr-1.5 font-mono text-xs text-slate-500 dark:text-slate-400">{issue.code}</code>
                {issue.reason}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Outreach">
        <OutreachBlock outreach={prospect.outreach} facts={prospect.facts} />
      </Section>

      {findings.length > 0 && prospect.outreach.state !== "suppressed" && (
        <Section title="Guardrail findings">
          <FindingsList findings={findings} />
        </Section>
      )}

      <details className="group rounded-lg border border-slate-200 dark:border-slate-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-100">
          Evidence facts ({prospect.facts.length})
        </summary>
        <div className="border-t border-slate-200 p-3 dark:border-slate-800">
          <FactsTable facts={prospect.facts} />
        </div>
      </details>
    </article>
  );
}
