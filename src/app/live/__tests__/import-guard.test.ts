// Static guard for the live page: no network calls (no fetch, no
// XMLHttpRequest, no /api/live), no environment variables, no logging of
// form values, no live provider or model gateway, and no core runtime code
// in the browser bundle.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const LIVE_DIR = resolve(__dirname, "..");
const SRC_DIR = resolve(LIVE_DIR, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
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

describe("live page network and secrets guard", () => {
  it("makes no network calls and does not mention the live API", () => {
    for (const file of liveSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket|navigator\.sendBeacon/);
      expect(code, rel(file)).not.toMatch(/\/api\/live/);
    }
  });

  it("reads no environment variables and logs nothing", () => {
    for (const file of liveSources) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code, rel(file)).not.toMatch(/process\.env|console\.|localStorage|sessionStorage|document\.cookie/);
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
    expect(client.map(rel)).toEqual(["app/live/_components/LivePreview.tsx"]);
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
