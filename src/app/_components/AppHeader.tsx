import { HeaderBadge } from "./HeaderBadge";

export function AppHeader() {
  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto flex h-16 w-full max-w-page items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" className="size-5">
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
              <path
                d="M7.05 7.05a7 7 0 0 0 0 9.9M16.95 7.05a7 7 0 0 1 0 9.9M4.22 4.22a11 11 0 0 0 0 15.56M19.78 4.22a11 11 0 0 1 0 15.56"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              SignalScout AI
            </span>
            <span className="hidden truncate text-xs text-slate-600 sm:block dark:text-slate-300">
              B2B prospect discovery and qualification
            </span>
          </div>
        </div>
        <HeaderBadge />
      </div>
    </header>
  );
}
