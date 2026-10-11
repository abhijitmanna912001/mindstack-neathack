// Static guard: starting from every source file of the results feature, walk
// the relative import graph and check that no live provider, real model
// gateway, tracing module or SDK is reachable, and that no reachable source
// reads process.env.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RESULTS_DIR = resolve(__dirname, "..");
const SRC_DIR = resolve(RESULTS_DIR, "..", "..");

const FORBIDDEN_FILES = [
  "core/data/crustdata-provider.ts",
  "core/agent/gateway-client.ts",
  "core/agent/openai-llm.ts",
  "core/agent/neatlogs-tracer.ts",
  "core/observability/tracing.ts",
];
const FORBIDDEN_PACKAGES = /^(openai|neatlogs)(\/|$)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push(m[1] ?? m[2] ?? m[3]);
  }
  return found;
}

function resolveRelative(from: string, spec: string): string | undefined {
  const base = spec.startsWith("@/") ? join(SRC_DIR, spec.slice(2)) : resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Every file reachable from the results feature, plus every bare package used.
function reachable(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = sourceFiles(RESULTS_DIR);
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        const target = resolveRelative(file, spec);
        if (target) queue.push(target);
      } else {
        packages.add(spec);
      }
    }
  }
  return { files, packages };
}

describe("results feature import guard", () => {
  const { files, packages } = reachable();
  const relativeFiles = [...files].map((f) => relative(SRC_DIR, f).replace(/\\/g, "/"));

  it("reaches the real improved pipeline and the fixture provider", () => {
    expect(relativeFiles).toContain("core/agent/improved-pipeline.ts");
    expect(relativeFiles).toContain("core/data/fixture-provider.ts");
    expect(relativeFiles).toContain("core/agent/fake-llm.ts");
  });

  it("never reaches a live provider, model gateway or tracing module", () => {
    for (const forbidden of FORBIDDEN_FILES) expect(relativeFiles, forbidden).not.toContain(forbidden);
  });

  it("never imports the openai or neatlogs SDKs", () => {
    expect([...packages].filter((p) => FORBIDDEN_PACKAGES.test(p))).toEqual([]);
  });

  it("never reads process.env in any reachable source", () => {
    const offenders = [...files].filter(
      (f) => /\.(ts|tsx)$/.test(f) && /process\.env/.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(offenders.map((f) => relative(SRC_DIR, f))).toEqual([]);
  });
});
