// Neatlogs tracing setup. Plain TypeScript: no Next.js imports.

import { flush, init, shutdown } from "neatlogs";

let initialised = false;

// Safe to call many times; only the first call initialises the SDK.
export async function initTracing(): Promise<void> {
  if (initialised) return;
  initialised = true;
  await init({
    apiKey: process.env.NEATLOGS_API_KEY,
    workflowName: "signalscout",
  });
}

// For scripts only: push pending spans out, then shut the SDK down.
export async function closeTracing(): Promise<void> {
  await flush();
  await shutdown();
  initialised = false;
}
