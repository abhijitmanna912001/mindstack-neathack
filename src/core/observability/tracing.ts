// Neatlogs tracing setup. Plain TypeScript: no Next.js imports.

import { flush, init, shutdown } from "neatlogs";

let initialised = false;

// Safe to call many times; only the first call initialises the SDK.
// The run label tags every span: options.run_label, else SIGNALSCOUT_RUN_LABEL.
export async function initTracing(options?: { run_label?: string }): Promise<void> {
  if (initialised) return;
  initialised = true;
  const label = options?.run_label ?? process.env.SIGNALSCOUT_RUN_LABEL;
  await init({
    apiKey: process.env.NEATLOGS_API_KEY,
    workflowName: "signalscout",
    ...(label ? { tags: [label] } : {}),
  });
}

// For scripts only: push pending spans out, then shut the SDK down.
export async function closeTracing(): Promise<void> {
  await flush();
  await shutdown();
  initialised = false;
}
