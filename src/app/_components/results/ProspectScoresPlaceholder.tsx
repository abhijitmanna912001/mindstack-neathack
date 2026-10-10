import { EmptyState, Panel, PlaceholderBadge, SkeletonBar } from "./Panel";

const COLUMNS = ["Company", "Fit score", "Tier", "Evidence"];

export function ProspectScoresPlaceholder({ pending }: { pending: boolean }) {
  return (
    <Panel
      title="Prospect scores"
      description="Qualified companies ranked by fit against your profile."
      badge={<PlaceholderBadge />}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium text-slate-600 dark:border-slate-800 dark:text-slate-300">
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className="py-2 pr-4 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <tr key={row} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                <td className="py-3 pr-4">
                  <SkeletonBar animated={pending} className="w-32" />
                </td>
                <td className="py-3 pr-4">
                  <SkeletonBar animated={pending} className="w-10" />
                </td>
                <td className="py-3 pr-4">
                  <SkeletonBar animated={pending} className="w-8" />
                </td>
                <td className="py-3 pr-4">
                  <SkeletonBar animated={pending} className="w-20" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EmptyState>Scored prospects will appear here after a run.</EmptyState>
    </Panel>
  );
}
