"use client";

// The live page's interactive form. By default it submits to the real route
// through the live-api adapter. With preview fixtures (/live?preview=1) it
// uses the local mock adapter and shows the simulated-response picker.
//
// The invitation code stays in form state only until a submission starts;
// it is never put in the URL, stored, logged or rendered afterwards.

import { type FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { createLiveApiAdapter } from "../_lib/live-api";
import { createLiveRunStore } from "../_lib/live-store";
import { createPreviewAdapter, type PreviewFixtures, type PreviewScenario } from "../_lib/preview";
import { LiveFormView } from "./LiveFormView";
import { LiveOutcome } from "./LiveOutcome";

export function LiveRun({ previewFixtures }: { previewFixtures?: PreviewFixtures }) {
  const [scenario, setScenario] = useState<PreviewScenario>("success");
  // Created once per mount. The store holds the submission lock, so a second
  // click before React re-renders is ignored. In preview mode the adapter
  // reads the chosen scenario from this closure.
  const [{ store, chooseScenario }] = useState(() => {
    let chosen: PreviewScenario = "success";
    const adapter = previewFixtures ? createPreviewAdapter(previewFixtures, () => chosen) : createLiveApiAdapter();
    return {
      store: createLiveRunStore(adapter),
      chooseScenario: (next: PreviewScenario) => {
        chosen = next;
      },
    };
  });
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  // Leaving the page stops waiting and clears the timer. It does not cancel
  // a run the server has already started.
  useEffect(() => () => store.cancel(), [store]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void store.submit();
  }

  return (
    <div className="flex flex-col gap-6">
      <LiveFormView
        values={state.values}
        errors={state.errors}
        submitting={state.view.kind === "loading"}
        onCodeChange={store.setCode}
        onIndustryChange={store.setIndustry}
        onSizeChange={store.setSize}
        onSubmit={onSubmit}
        preview={
          previewFixtures
            ? {
                scenario,
                onScenarioChange: (next) => {
                  chooseScenario(next);
                  setScenario(next);
                },
              }
            : undefined
        }
      />
      <LiveOutcome
        state={state.view}
        preview={previewFixtures !== undefined}
        elapsedSeconds={state.elapsedSeconds}
        onBack={store.back}
        onRetry={() => void store.submit()}
      />
    </div>
  );
}
