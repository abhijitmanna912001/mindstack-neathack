"use client";

import { useActionState } from "react";
import { submitIcp } from "../actions";
import { INITIAL_ICP_FORM_STATE } from "../_lib/icp-form";
import { IcpForm } from "./IcpForm";
import { ResultsPanel } from "./results/ResultsPanel";

// Owns the form state so the form and the results area stay in sync. Both
// children are plain components that take props, so they can be reused once
// the agent pipeline returns real results.
export function ProspectWorkspace() {
  const [state, formAction, pending] = useActionState(
    submitIcp,
    INITIAL_ICP_FORM_STATE,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6">
        <IcpForm action={formAction} state={state} pending={pending} />
      </div>
      <ResultsPanel
        icp={state.status === "accepted" ? state.icp : null}
        pending={pending}
      />
    </div>
  );
}
