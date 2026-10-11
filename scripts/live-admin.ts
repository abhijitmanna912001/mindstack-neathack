// Admin CLI for live mode. Reads DATABASE_URL and INVITE_HMAC_SECRET from the
// environment, never prints them, and prints a new invite code exactly once.
// Exit codes: 0 ok, 1 failure, 2 usage.

import { pathToFileURL } from "node:url";
import { generateInviteCode, hashCode } from "../src/server/live/codes";
import { connectPgStore } from "../src/server/live/pg-store";
import type { LiveStore } from "../src/server/live/store";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const USAGE = `usage:
  live-admin create --label X --runs N
  live-admin list
  live-admin disable --label X
  live-admin enable --label X
  live-admin add-runs --label X --n N
  live-admin kill-switch on|off|status`;

export type AdminCommand =
  | { kind: "create"; label: string; runs: number }
  | { kind: "list" }
  | { kind: "disable"; label: string }
  | { kind: "enable"; label: string }
  | { kind: "add-runs"; label: string; n: number }
  | { kind: "kill-switch"; action: "on" | "off" | "status" };

class UsageError extends Error {}

function flags(args: string[], names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, "");
    const value = args[i + 1];
    if (!args[i]?.startsWith("--") || !names.includes(name) || !value) {
      throw new UsageError("bad flags");
    }
    out[name] = value;
  }
  if (names.some((n) => !(n in out))) throw new UsageError("missing flag");
  return out;
}

function count(text: string, min: number): number {
  if (!/^\d+$/.test(text) || Number(text) < min) throw new UsageError("bad number");
  return Number(text);
}

export function parseAdminArgs(argv: string[]): AdminCommand {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "create": {
      const f = flags(rest, ["label", "runs"]);
      return { kind: "create", label: f.label, runs: count(f.runs, 0) };
    }
    case "list":
      if (rest.length) throw new UsageError("unexpected args");
      return { kind: "list" };
    case "disable":
    case "enable":
      return { kind: cmd, label: flags(rest, ["label"]).label };
    case "add-runs": {
      const f = flags(rest, ["label", "n"]);
      return { kind: "add-runs", label: f.label, n: count(f.n, 1) };
    }
    case "kill-switch":
      if (rest.length !== 1 || !["on", "off", "status"].includes(rest[0])) {
        throw new UsageError("bad action");
      }
      return { kind: "kill-switch", action: rest[0] as "on" | "off" | "status" };
    default:
      throw new UsageError("unknown command");
  }
}

async function execute(
  cmd: AdminCommand,
  store: LiveStore,
  secret: string,
  out: (line: string) => void,
): Promise<number> {
  const missing = (label: string) => {
    out(`no code with label "${label}"`);
    return EXIT_FAILED;
  };
  switch (cmd.kind) {
    case "create": {
      const code = generateInviteCode();
      if (!(await store.admin.createCode(cmd.label, cmd.runs, hashCode(code, secret)))) {
        out(`label "${cmd.label}" already exists`);
        return EXIT_FAILED;
      }
      out(`created "${cmd.label}" with ${cmd.runs} runs`);
      out(`code (shown once, store it now): ${code}`);
      return EXIT_OK;
    }
    case "list": {
      for (const c of await store.admin.listCodes()) {
        out(
          `${c.label}\t${c.runsUsed}/${c.maxRuns} used\t${c.disabled ? "disabled" : "enabled"}`,
        );
      }
      return EXIT_OK;
    }
    case "disable":
    case "enable": {
      const found =
        cmd.kind === "disable"
          ? await store.admin.disableCode(cmd.label)
          : await store.admin.enableCode(cmd.label);
      if (!found) return missing(cmd.label);
      out(`${cmd.kind}d "${cmd.label}"`);
      return EXIT_OK;
    }
    case "add-runs":
      if (!(await store.admin.addRuns(cmd.label, cmd.n))) return missing(cmd.label);
      out(`added ${cmd.n} runs to "${cmd.label}"`);
      return EXIT_OK;
    case "kill-switch":
      if (cmd.action === "status") {
        out(`live mode is ${(await store.isLiveEnabled()) ? "ON" : "OFF"}`);
      } else {
        await store.setLiveEnabled(cmd.action === "on");
        out(`live mode is now ${cmd.action.toUpperCase()}`);
      }
      return EXIT_OK;
  }
}

async function main(): Promise<number> {
  let cmd: AdminCommand;
  try {
    cmd = parseAdminArgs(process.argv.slice(2));
  } catch {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.INVITE_HMAC_SECRET;
  if (!databaseUrl || !secret) {
    console.error("DATABASE_URL and INVITE_HMAC_SECRET must both be set");
    return EXIT_FAILED;
  }
  let close: (() => Promise<void>) | undefined;
  try {
    const conn = await connectPgStore(databaseUrl);
    close = conn.close;
    return await execute(cmd, conn.store, secret, (l) => console.log(l));
  } catch (err) {
    // Only the error class: messages from drivers can echo connection details.
    console.error(`failed: ${err instanceof Error ? err.name : "error"}`);
    return EXIT_FAILED;
  } finally {
    await close?.().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
