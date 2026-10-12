// Static guard for the live page: network access only through the one
// adapter file and only to /api/live/run, no environment variables, no
// logging, storage, cookies or URL changes, no live provider or model
// gateway, and no core runtime code in the browser bundle.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LIVE_RUN_PATH } from "../_lib/live-api";

const LIVE_DIR = resolve(__dirname, "..");
const SRC_DIR = resolve(LIVE_DIR, "..", "..");
const APP_DIR = join(SRC_DIR, "app");

// Production files: no tests. `skip` names directories left out entirely.
function sourceFiles(dir: string, skip: readonly string[] = []): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || skip.includes(path) ? [] : sourceFiles(path, skip);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Relative and bare imports; `typesToo` includes type-only imports, which
// are erased from the bundle.
function imports(source: string, typesToo: boolean): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(import|export)\s+(type\s+)?[^"';]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
    if (m[4]) found.push(m[4]);
    else if (typesToo || !m[2]) found.push(m[3]);
  }
  return found;
}

function resolveImport(from: string, spec: string): string | undefined {
  const base = spec.startsWith("@/") ? join(SRC_DIR, spec.slice(2)) : resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return undefined;
}

function walk(entries: string[], typesToo: boolean): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    for (const spec of imports(readFileSync(file, "utf8"), typesToo)) {
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        const target = resolveImport(file, spec);
        if (target) queue.push(target);
      } else packages.add(spec);
    }
  }
  return { files: [...files], packages: [...packages] };
}

const rel = (f: string) => relative(SRC_DIR, f).replace(/\\/g, "/");
const liveSources = sourceFiles(LIVE_DIR);

// The web app's own production code. The backend route under src/app/api
// is Abhijit's server code and is not part of this guard.
const appSources = sourceFiles(APP_DIR, [join(APP_DIR, "api")]);
const ADAPTER = "app/live/_lib/live-api.ts";

describe("live page network and secrets guard", () => {
  it("lets exactly one production file use fetch: the live-api adapter", () => {
    const users = appSources.filter((f) => /\bfetch\b/.test(stripComments(readFileSync(f, "utf8"))));
    expect(users.map(rel)).toEqual([ADAPTER]);
  });

  it("makes that one fetch call to /api/live/run only", () => {
    expect(LIVE_RUN_PATH).toBe("/api/live/run");
    const code = stripComments(readFileSync(join(SRC_DIR, ADAPTER), "utf8"));
    expect(code.match(/\bfetch\b/g)).toHaveLength(1);
    expect(code).toMatch(/\bfetch\(LIVE_RUN_PATH,/);
    expect(code).toMatch(/export const LIVE_RUN_PATH = "\/api\/live\/run";/);
    // No other address of any kind.
    expect(code.match(/["'`]\/api\/[^"'`]*["'`]/g)).toEqual(['"/api/live/run"']);
    expect(code).not.toMatch(/https?:\/\//);
  });

  it("uses no other network API, and mentions the route only in the adapter", () => {
    for (const file of appSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/XMLHttpRequest|EventSource|WebSocket|navigator\.sendBeacon|\baxios\b/);
      if (rel(file) !== ADAPTER) expect(code, rel(file)).not.toMatch(/\/api\/live/);
    }
  });

  it("reads no environment variables, logs nothing, and never stores or puts anything in the URL", () => {
    for (const file of liveSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/process\.env|console\.|localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(code, rel(file)).not.toMatch(/\bhistory\.|\blocation\.|pushState|replaceState|useRouter|useSearchParams/);
    }
  });

  it("never reaches a live provider, model gateway or tracing module", () => {
    const { files, packages } = walk(liveSources, true);
    const reached = files.map(rel);
    for (const forbidden of [
      "core/data/crustdata-provider.ts",
      "core/agent/gateway-client.ts",
      "core/agent/openai-llm.ts",
      "core/agent/neatlogs-tracer.ts",
      "core/observability/tracing.ts",
    ]) {
      expect(reached).not.toContain(forbidden);
    }
    expect(packages.filter((p) => /^(openai|neatlogs)(\/|$)/.test(p))).toEqual([]);
  });

  it("keeps core runtime code out of the client component's bundle", () => {
    const client = liveSources.filter((f) => readFileSync(f, "utf8").startsWith('"use client"'));
    expect(client.map(rel)).toEqual(["app/live/_components/LiveRun.tsx"]);
    const { files } = walk(client, false);
    const runtimeCore = files
      .map(rel)
      .filter(
        (f) =>
          f.startsWith("core/") ||
          f.startsWith("server/") ||
          f.endsWith("_lib/fixtures.ts") ||
          f.endsWith("_lib/live-results.ts") ||
          f.endsWith("_lib/presentation.ts"),
      );
    expect(runtimeCore).toEqual([]);
  });

  it("does not import server code from the page", () => {
    const { files } = walk(liveSources, true);
    expect(files.map(rel).filter((f) => f.startsWith("server/"))).toEqual([]);
  });

  it("does not create backend routes", () => {
    expect(existsSync(join(LIVE_DIR, "route.ts"))).toBe(false);
    expect(liveSources.map(rel).some((f) => f.includes("/api/"))).toBe(false);
  });
});
