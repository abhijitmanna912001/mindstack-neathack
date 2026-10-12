"use client";

// The header's route-specific badge. A small client component so the rest of
// the header stays a server component; usePathname gives the right badge on
// the first render and updates it after client-side navigation.

import { usePathname } from "next/navigation";
import { HEADER_BADGE_LABELS, headerBadgeFor } from "../_lib/header-badge";

const STYLES = {
  synthetic: {
    badge:
      "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
    dot: "bg-emerald-500",
  },
  beta: {
    badge:
      "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/30",
    dot: "bg-indigo-500",
  },
} as const;

export function HeaderBadge() {
  const kind = headerBadgeFor(usePathname());
  const style = STYLES[kind];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${style.badge}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${style.dot}`} />
      {HEADER_BADGE_LABELS[kind]}
    </span>
  );
}
