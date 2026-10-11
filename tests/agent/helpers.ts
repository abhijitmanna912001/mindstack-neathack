// Test doubles for the agent pipeline. No network: data comes from the
// synthetic fixtures and model output from FakeLlmClient.

import type { FakeLlmClientOptions } from "../../src/core/agent/fake-llm";
import { FakeLlmClient } from "../../src/core/agent/fake-llm";
import type {
  PipelineSpan,
  PipelineTracer,
  TraceAttributeValue,
} from "../../src/core/agent/tracer";
import type { IcpInput, ImprovedPipelineDeps } from "../../src/core/agent/types";
import {
  FixtureProvider,
  type FixtureProviderOptions,
} from "../../src/core/data/fixture-provider";
import type {
  CompanyProvider,
  ProviderResult,
  SearchFilters,
} from "../../src/core/data/provider";
import { DEV_RUN_CONFIG, type RawCompany, type RunConfig } from "../../src/core/types";

// The evaluation limits for both evidence runs: 10 searched, 5 enrichments,
// and DEV_RUN_CONFIG's model and call caps. Passed as options; the shared
// RunConfig constants are unchanged.
export const EVIDENCE_CONFIG: RunConfig = { ...DEV_RUN_CONFIG, max_enrichments: 5 };

// Matches every fixture: no industry, size or location filter.
export const OPEN_ICP: IcpInput = {
  industry: "",
  employee_count_ranges: [],
  locations: [],
  keywords: [],
  excluded_domains: [],
};

export function icp(overrides: Partial<IcpInput>): IcpInput {
  return { ...OPEN_ICP, ...overrides };
}

export interface RecordedSpan {
  readonly name: string;
  readonly kind: string;
  readonly input: unknown;
  readonly attributes: Record<string, TraceAttributeValue>;
  readonly events: { name: string; attributes?: Record<string, TraceAttributeValue> }[];
  readonly children: RecordedSpan[];
}

// In-memory tracer that keeps the span tree. Relies on spans running one at a
// time, which the pipeline guarantees.
export function createRecordingTracer(): { tracer: PipelineTracer; roots: RecordedSpan[] } {
  const roots: RecordedSpan[] = [];
  const stack: RecordedSpan[] = [];
  const tracer: PipelineTracer = {
    async span(options, fn) {
      const recorded: RecordedSpan = {
        name: options.name,
        kind: options.kind,
        input: options.input,
        attributes: { ...options.attributes },
        events: [],
        children: [],
      };
      (stack.at(-1)?.children ?? roots).push(recorded);
      const handle: PipelineSpan = {
        setAttributes: (attributes) => Object.assign(recorded.attributes, attributes),
        addEvent: (name, attributes) =>
          recorded.events.push({ name, attributes: attributes && { ...attributes } }),
      };
      stack.push(recorded);
      try {
        return await fn(handle);
      } finally {
        stack.pop();
      }
    },
  };
  return { tracer, roots };
}

export function flattenSpans(spans: readonly RecordedSpan[]): RecordedSpan[] {
  return spans.flatMap((s) => [s, ...flattenSpans(s.children)]);
}

export interface SpyProviderOptions {
  // Rewrites the enrich result before the pipeline sees it.
  readonly enrichResult?: (
    result: ProviderResult<readonly RawCompany[]>,
  ) => ProviderResult<readonly RawCompany[]>;
}

// Wraps a provider and records every call's arguments.
export class SpyProvider implements CompanyProvider {
  readonly autocompleteCalls: string[] = [];
  readonly searchCalls: { filters: SearchFilters; limit: number }[] = [];
  readonly enrichCalls: (readonly string[])[] = [];
  private readonly inner: CompanyProvider;
  private readonly options: SpyProviderOptions;

  constructor(inner: CompanyProvider, options: SpyProviderOptions = {}) {
    this.inner = inner;
    this.options = options;
  }

  autocompleteIndustry(query: string) {
    this.autocompleteCalls.push(query);
    return this.inner.autocompleteIndustry(query);
  }

  searchCompanies(filters: SearchFilters, limit: number) {
    this.searchCalls.push({ filters, limit });
    return this.inner.searchCompanies(filters, limit);
  }

  async enrichCompanies(linkedin_urls: readonly string[]) {
    this.enrichCalls.push(linkedin_urls);
    const result = await this.inner.enrichCompanies(linkedin_urls);
    return this.options.enrichResult ? this.options.enrichResult(result) : result;
  }
}

export interface Harness {
  readonly fixture: FixtureProvider;
  readonly provider: SpyProvider;
  readonly llm: FakeLlmClient;
  readonly roots: RecordedSpan[];
  // Satisfies both pipelines: the baseline ignores fact_provider.
  readonly deps: ImprovedPipelineDeps;
}

// One run's worth of collaborators. The fixture provider's caps come from
// `providerConfig` (default: the pipeline config), so tests can make the
// provider's BudgetGuard stricter than the pipeline's own limits.
export function harness(
  config: RunConfig,
  options: {
    readonly fixture?: Omit<FixtureProviderOptions, "config">;
    readonly providerConfig?: Pick<RunConfig, "max_search_results" | "max_enrichments">;
    readonly spy?: SpyProviderOptions;
    readonly llm?: FakeLlmClientOptions;
  } = {},
): Harness {
  const fixture = new FixtureProvider({
    config: options.providerConfig ?? config,
    ...options.fixture,
  });
  const provider = new SpyProvider(fixture, options.spy);
  const llm = new FakeLlmClient(options.llm);
  const { tracer, roots } = createRecordingTracer();
  let clock = 0;
  return {
    fixture,
    provider,
    llm,
    roots,
    deps: {
      provider,
      budget: fixture.budget,
      llm,
      fact_provider: "fixture",
      tracer,
      trace_id: "trace-test",
      now: () => (clock += 1),
    },
  };
}
