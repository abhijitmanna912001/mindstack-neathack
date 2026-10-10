import { Panel, PlaceholderBadge } from "./Panel";

const METERS = ["Searches", "Enrichments", "Credits"];

export function BudgetUsagePlaceholder() {
  return (
    <Panel
      title="Budget usage"
      description="Crustdata usage for this run, against limits set on the server."
      badge={<PlaceholderBadge>Synthetic</PlaceholderBadge>}
    >
      <ul className="flex flex-col gap-3">
        {METERS.map((meter) => (
          <li key={meter} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">{meter}</span>
              <span className="tabular-nums text-slate-500 dark:text-slate-400">0 used</span>
            </div>
            <div
              role="meter"
              aria-label={`${meter} used`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={0}
              className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800"
            />
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Synthetic mode never calls Crustdata, so no credits are spent.
      </p>
    </Panel>
  );
}
