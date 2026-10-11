"use client";

// The live page's interactive preview. Submissions go to a local mock
// adapter that returns synthetic fixture responses; no network request is
// made. The invitation code stays in component state only: it is never put
// in the URL, stored or logged.

import { type FormEvent, useRef, useState } from "react";
import { createPreviewAdapter, type PreviewFixtures, type PreviewScenario } from "../_lib/preview";
import {
  createSubmissionController,
  type LiveViewState,
  type SubmissionController,
  viewStateFor,
} from "../_lib/submission";
import {
  EMPTY_LIVE_FORM,
  type LiveFormErrors,
  type LiveFormValues,
  toggleSize,
  validateLiveForm,
} from "../_lib/validation";
import { LiveFormView } from "./LiveFormView";
import { LiveOutcome } from "./LiveOutcome";

export function LivePreview({ fixtures }: { fixtures: PreviewFixtures }) {
  const [values, setValues] = useState<LiveFormValues>(EMPTY_LIVE_FORM);
  const [errors, setErrors] = useState<LiveFormErrors>({});
  const [scenario, setScenario] = useState<PreviewScenario>("success");
  const [view, setView] = useState<LiveViewState>({ kind: "idle" });
  const scenarioRef = useRef<PreviewScenario>("success");
  const controllerRef = useRef<SubmissionController | null>(null);

  function controller(): SubmissionController {
    controllerRef.current ??= createSubmissionController(
      createPreviewAdapter(fixtures, () => scenarioRef.current),
    );
    return controllerRef.current;
  }

  async function run() {
    const checked = validateLiveForm(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    const submissions = controller();
    // One run at a time: a second submit while one is running does nothing.
    if (submissions.inFlight) return;
    setView({ kind: "loading" });
    const outcome = await submissions.submit(checked.request);
    if (outcome.kind === "done") setView(viewStateFor(outcome.response));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run();
  }

  return (
    <div className="flex flex-col gap-6">
      <LiveFormView
        values={values}
        errors={errors}
        submitting={view.kind === "loading"}
        scenario={scenario}
        onCodeChange={(code) => setValues((v) => ({ ...v, code }))}
        onIndustryChange={(industry) => setValues((v) => ({ ...v, industry }))}
        onSizeChange={(size, checked) => setValues((v) => ({ ...v, sizes: toggleSize(v.sizes, size, checked) }))}
        onScenarioChange={(next) => {
          scenarioRef.current = next;
          setScenario(next);
        }}
        onSubmit={onSubmit}
      />
      <LiveOutcome state={view} preview onBack={() => setView({ kind: "idle" })} onRetry={() => void run()} />
    </div>
  );
}
