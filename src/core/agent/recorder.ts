// Accumulates the per-step counts, costs and timings that make up a Run.

import type { Run, RunConfig, RunStep } from "../types";

const STEPS: readonly RunStep[] = ["plan", "search", "validate", "enrich", "assess"];

function zeroByStep(): Record<RunStep, number> {
  return Object.fromEntries(STEPS.map((s) => [s, 0])) as Record<RunStep, number>;
}

export class RunRecorder {
  readonly counts = {
    searched: 0,
    enriched: 0,
    delivered: 0,
    llm_calls: 0,
    llm_input_tokens: 0,
    llm_output_tokens: 0,
  };
  private readonly costs = zeroByStep();
  private readonly timings = zeroByStep();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  async time<T>(step: RunStep, fn: () => Promise<T>): Promise<T> {
    const start = this.now();
    try {
      return await fn();
    } finally {
      this.timings[step] += this.now() - start;
    }
  }

  addCost(step: RunStep, cost_usd: number): void {
    this.costs[step] += cost_usd;
  }

  build(trace_id: string, input_description: string, config: RunConfig): Run {
    return {
      trace_id,
      input_description,
      config,
      counts: { ...this.counts },
      cost_usd_by_step: { ...this.costs },
      timings_ms_by_step: { ...this.timings },
    };
  }
}
