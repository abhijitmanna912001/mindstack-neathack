import type { ReactNode } from "react";
import { Panel } from "../../_components/results/Panel";
import { StatTile } from "../../_components/results/StatTile";
import { Badge } from "../../results/_components/Badge";
import { ASSESSED_HINT, DELIVERED_HINT } from "../../results/_components/RunSummary";
import type { LiveCostDto, LiveResultsDto } from "../_lib/live-results";

type Run = LiveResultsDto["run"];

export const CRUSTDATA_SOURCE_OF_TRUTH =
  "The Crustdata usage page is the source of truth for what was actually charged.";

const usd2 = (n: number) => (n > 0 && n < 0.01 ? "< $0.01" : `$${n.toFixed(2)}`);
const usd4 = (n: number) => (n > 0 && n < 0.0001 ? "< $0.0001" : `$${n.toFixed(4)}`);
const calls = (n: number) => `${n} ${n === 1 ? "call" : "calls"}`;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-medium text-slate-700 dark:text-slate-200">{label}</dt>
      <dd className="min-w-0 text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">{children}</dd>
    </>
  );
}

function Counts({ run, modelCallsLabel }: { run: Run; modelCallsLabel: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <StatTile label="Companies searched" value={String(run.counts.searched)} />
      <StatTile label="Enriched" value={String(run.counts.enriched)} />
      <StatTile label="Assessed" value={String(run.counts.assessed)} hint={ASSESSED_HINT} />
      <StatTile label="Delivered (eligible)" value={String(run.counts.delivered)} hint={DELIVERED_HINT} />
      <StatTile label={modelCallsLabel} value={String(run.counts.model_calls)} />
    </div>
  );
}

const limitsText = (run: Run) =>
  `Limits: ${run.limits.max_search_results} searched, ${run.limits.max_enrichments} enrichments, ${run.limits.max_llm_calls_per_run} model calls.`;

const KNOWN_KIND: Readonly<Record<LiveCostDto["model_basis"], string>> = {
  none: "",
  unavailable: "",
  gateway_reported: "reported by the model gateway",
  estimated: "estimated from token usage at fallback rates",
  mixed: "partly reported by the model gateway and partly estimated from token usage at fallback rates",
};

// The live model cost, with its basis. Only a complete, gateway-reported
// amount is called a total. An incomplete amount is a lower bound, and an
// unavailable cost shows no amount, so an unknown cost never reads as $0.
export function liveModelCostText(cost: LiveCostDto, modelCalls: number): string {
  const total = Math.max(modelCalls, cost.model_calls_unavailable);
  const amount = usd4(cost.model_usd);
  switch (cost.model_basis) {
    case "none":
      return "No model calls were made in this run.";
    case "unavailable":
      return `Unavailable: no cost information for ${total === 1 ? "the model call" : `any of the ${total} model calls`}.`;
    default:
      if (!cost.model_complete) {
        const missing =
          cost.model_calls_unavailable > 0
            ? `${cost.model_calls_unavailable} of ${calls(total)} have no cost information`
            : "the model cost was reported as incomplete";
        return `At least ${amount} (incomplete): ${missing}. The known amount is ${KNOWN_KIND[cost.model_basis]}.`;
      }
      if (cost.model_basis === "gateway_reported") {
        return `${amount} total, reported by the model gateway for ${calls(total)}.`;
      }
      if (cost.model_basis === "estimated") {
        return `${amount}, estimated from token usage at fallback rates for ${calls(total)}.`;
      }
      return `${amount}, ${KNOWN_KIND.mixed} across ${calls(total)}. Part of it is an estimate, so it is not a confirmed total.`;
  }
}

function SyntheticSummary({ run }: { run: Run }) {
  const { cost } = run;
  return (
    <Panel
      title="Demo run summary"
      description={`Synthetic demo run of the improved pipeline, status: ${run.status}. ${limitsText(run)}`}
      badge={<Badge tone="warn">Demo data (synthetic)</Badge>}
    >
      <Counts run={run} modelCallsLabel="Fake-model calls" />
      <dl className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] dark:bg-slate-800/50">
        <Row label="Data">
          Synthetic fixture companies. No real company search was made, and your search criteria were not used.
        </Row>
        <Row label="Model">
          {run.model}: a deterministic fake model in this app. No external model was called.
        </Row>
        <Row label="Simulated provider cost">
          {usd2(cost.provider_usd)}, simulated from fixture per-record prices. Not a charge.
        </Row>
        <Row label="Model cost">
          None: no external model was called. The {run.counts.model_calls} fake-model{" "}
          {run.counts.model_calls === 1 ? "call" : "calls"} ran inside this app.
        </Row>
        <Row label="Actual charges">None: no external provider or model was called for this demo run.</Row>
        <Row label="Fact provenance">{run.fact_provider} (synthetic fixtures)</Row>
      </dl>
    </Panel>
  );
}

function LiveSummary({ run }: { run: Run }) {
  const { cost } = run;
  return (
    <Panel
      title="Live run summary"
      description={`Live run of the improved pipeline on Crustdata data, status: ${run.status}. ${limitsText(run)}`}
      badge={<Badge tone="info">Live Crustdata data</Badge>}
    >
      <Counts run={run} modelCallsLabel="Model calls" />
      <dl className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] dark:bg-slate-800/50">
        <Row label="Data">Live Crustdata data: companies returned by the Crustdata API for this search.</Row>
        <Row label="Model">{run.model}</Row>
        <Row label="Provider cost estimate">
          {cost.provider_usd > 0 ? usd4(cost.provider_usd) : "None estimated"}: estimated from the records searched and
          enriched at measured per-record prices. It is an estimate, not an invoice. {CRUSTDATA_SOURCE_OF_TRUTH}
        </Row>
        <Row label="Model cost">
          <span className="inline-flex flex-wrap items-center gap-2">
            {!cost.model_complete && <Badge tone="warn">Incomplete</Badge>}
            <span>{liveModelCostText(cost, run.counts.model_calls)}</span>
          </span>
        </Row>
        <Row label="Fact provenance">{run.fact_provider} (live Crustdata records)</Row>
      </dl>
    </Panel>
  );
}

export function LiveRunSummary({ results }: { results: LiveResultsDto }) {
  return results.run.mode === "live" ? <LiveSummary run={results.run} /> : <SyntheticSummary run={results.run} />;
}
