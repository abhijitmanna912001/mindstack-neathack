import "server-only";

import { toResultsDto } from "../../../results/_lib/presentation";
import { createMemoizedConnector, type LiveRuntime } from "../../../../server/live/handlers";
import { type LiveConfig, connectStore, readLiveConfig } from "../../../../server/live/config";
import { type LiveDeps, type ToResults, realFactories } from "../../../../server/live/run-live";
import type { LiveStore } from "../../../../server/live/store";

// FAIL-SAFE: a live-safe results mapper must exist before live runs are
// allowed. toResultsDto is not one: it hard-codes synthetic facts. While this
// is null, deps.live is null whatever the environment says, so a live run can
// never spend money before a truthful mapper exists.
export const LIVE_RESULTS_MAPPER: ToResults | null = null;

export function buildLiveDeps(
  config: LiveConfig,
  store: LiveStore,
  mapper: ToResults | null = LIVE_RESULTS_MAPPER,
): LiveDeps {
  return {
    store,
    hmacSecret: config.hmacSecret,
    live: mapper === null ? null : config.live,
    now: () => new Date(),
    ...realFactories,
    toResults: (result, ctx) => {
      if (ctx.mode === "synthetic") return toResultsDto(result);
      if (mapper === null) throw new Error("no live results mapper");
      return mapper(result, ctx);
    },
  };
}

interface Connected {
  readonly config: LiveConfig;
  readonly store: LiveStore;
}

let connect: (() => Promise<Connected>) | null = null;

async function connected(): Promise<Connected | null> {
  const read = readLiveConfig(process.env);
  if (!read.ok) return null;
  connect ??= createMemoizedConnector(async () => {
    const { store } = await connectStore(read.config.databaseUrl);
    return { config: read.config, store };
  });
  return connect();
}

export const runtime: LiveRuntime = {
  async getDeps() {
    const c = await connected();
    return c === null ? null : buildLiveDeps(c.config, c.store);
  },
  async getStore() {
    return (await connected())?.store ?? null;
  },
};
