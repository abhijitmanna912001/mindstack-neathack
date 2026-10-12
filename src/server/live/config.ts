// Live-mode configuration. The environment is read in exactly one function
// (readLiveConfig) and values are passed explicitly from there. Results name
// missing variables, never their values.

import { PgLiveStore, type PgDb } from "./pg-store";

export interface LiveKeys {
  readonly crustdataApiKey: string;
  readonly llmApiKey: string;
  readonly llmBaseUrl: string;
  // Optional LIVE_LLM_MODEL; absent means LIVE_RUN_CONFIG.model.
  readonly llmModel?: string;
}

export interface LiveConfig {
  readonly databaseUrl: string;
  readonly hmacSecret: string;
  // null when any live-mode key is missing: synthetic codes still work.
  readonly live: LiveKeys | null;
  // Names only.
  readonly missingLiveKeys: readonly string[];
}

export type LiveConfigResult =
  | { readonly ok: true; readonly config: LiveConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

type Env = Readonly<Record<string, string | undefined>>;

const MODEL_NAME = /^[A-Za-z0-9._:/-]{1,64}$/;

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function readLiveConfig(env: Env = process.env): LiveConfigResult {
  const databaseUrl = env.DATABASE_URL;
  const hmacSecret = env.INVITE_HMAC_SECRET;
  const crustdataApiKey = env.CRUSTDATA_LIVE_API_KEY;
  const llmApiKey = env.LIVE_LLM_API_KEY;
  const llmBaseUrl = env.LIVE_LLM_BASE_URL;
  const llmModel = env.LIVE_LLM_MODEL;

  const missing: string[] = [];
  if (!present(databaseUrl)) missing.push("DATABASE_URL");
  if (!present(hmacSecret)) missing.push("INVITE_HMAC_SECRET");
  if (!present(databaseUrl) || !present(hmacSecret)) return { ok: false, missing };

  const missingLiveKeys: string[] = [];
  if (!present(crustdataApiKey)) missingLiveKeys.push("CRUSTDATA_LIVE_API_KEY");
  if (!present(llmApiKey)) missingLiveKeys.push("LIVE_LLM_API_KEY");
  if (!present(llmBaseUrl)) missingLiveKeys.push("LIVE_LLM_BASE_URL");

  // Optional: absent keeps the default model, but a value that is set must be valid.
  const modelSet = present(llmModel);
  const modelValid = !modelSet || MODEL_NAME.test(llmModel);
  if (!modelValid) missingLiveKeys.push("LIVE_LLM_MODEL");

  const live =
    present(crustdataApiKey) && present(llmApiKey) && present(llmBaseUrl) && modelValid
      ? { crustdataApiKey, llmApiKey, llmBaseUrl, ...(modelSet ? { llmModel } : {}) }
      : null;
  return { ok: true, config: { databaseUrl, hmacSecret, live, missingLiveKeys } };
}

// Serverless-sized pool. The managed database may need several seconds to
// wake up, hence the 10 s connection timeout. pg is imported lazily so unit
// tests never load it. Not called by any test.
export async function connectStore(
  databaseUrl: string,
): Promise<{ store: PgLiveStore; close(): Promise<void> }> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });
  const db: PgDb = {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: (t, p) => client.query(t, p) });
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
  return { store: new PgLiveStore(db), close: () => pool.end() };
}
