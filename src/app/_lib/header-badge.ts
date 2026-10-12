// The header badge's wording for each route. The live beta (/live, including
// /live?preview=1, whose pathname is also /live) is invite only; every other
// page, such as / and /results, uses synthetic data.

export type HeaderBadgeKind = "synthetic" | "beta";

export const HEADER_BADGE_LABELS: Readonly<Record<HeaderBadgeKind, string>> = {
  synthetic: "Synthetic data mode",
  beta: "Invite only beta",
};

export function headerBadgeFor(pathname: string | null): HeaderBadgeKind {
  return pathname === "/live" || pathname?.startsWith("/live/") ? "beta" : "synthetic";
}
