import type { ReactNode } from "react";

type PanelProps = {
  title: string;
  description?: string;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Panel({ title, description, badge, className, children }: PanelProps) {
  const headingId = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 ${className ?? ""}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3
            id={headingId}
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            {title}
          </h3>
          {description && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        {badge}
      </header>
      {children}
    </section>
  );
}

export function PlaceholderBadge({ children = "Awaiting run" }: { children?: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {children}
    </p>
  );
}

export function SkeletonBar({ className, animated }: { className?: string; animated?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`block h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 ${animated ? "animate-pulse" : ""} ${className ?? ""}`}
    />
  );
}
