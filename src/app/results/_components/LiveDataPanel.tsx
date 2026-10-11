import { Panel } from "../../_components/results/Panel";
import type { EvidenceState } from "../_lib/evidence";
import { Badge } from "./Badge";

// Live-data (real Crustdata) evaluation. The evidence summary's real_data is
// null until that evaluation exists; fixture figures are never shown here.
export function LiveDataPanel({ state }: { state: EvidenceState }) {
  const liveData = state.state === "ready" ? state.live_data.state : "pending";
  return (
    <Panel
      title="Live-data evaluation"
      description="Baseline versus improved on real provider data."
      badge={<Badge tone="neutral">{liveData === "pending" ? "Pending" : "Not yet supported"}</Badge>}
    >
      <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
        {liveData === "pending"
          ? "The live-data evaluation has not been published. No live-data results are shown, and the fixture results above are not a substitute for them."
          : "The evidence summary contains live-data results, but this page does not display them yet. No live-data figures are shown."}
      </p>
    </Panel>
  );
}
