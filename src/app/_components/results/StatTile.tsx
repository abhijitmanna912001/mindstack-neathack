type StatTileProps = {
  label: string;
  value: string;
  hint?: string;
};

export function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </span>
      {hint && <span className="text-xs text-slate-600 dark:text-slate-300">{hint}</span>}
    </div>
  );
}
