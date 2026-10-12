import "server-only";

import { toLiveResultsDto } from "../../../live/_lib/live-results";
import { createMemoizedConnector, type LiveRuntime } from "../../../../server/live/handlers";
import { type LiveConfig, connectStore, readLiveConfig } from "../../../../server/live/config";
import { type LiveDeps, type ToResults, realFactories } from "../../../../server/live/run-live";
import type { LiveStore } from "../../../../server/live/store";

// FAIL-SAFE: live runs are allowed only with a live-safe results mapper.
// toLiveResultsDto is one: it reports the estimated provider cost and the
// model cost with its basis, and never claims zero spend for a live run. If
// this is ever null, deps.live is null whatever the environment says, so a
// live run can never spend money without a truthful mapper.
export const LIVE_RESULTS_MAPPER: ToResults | null = toLiveResultsDto;

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
      if (ctx.mode === "synthetic") return toLiveResultsDto(result, ctx);
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
