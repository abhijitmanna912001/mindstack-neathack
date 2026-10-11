// Server-rendered output of the official evidence, live-data, demo and
// rejection components. Expected figures come from the imported evidence
// file, never from literals.

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import summary from "../../../../evidence/summary.json";
import { DemoNotice } from "../_components/DemoNotice";
import { LiveDataPanel } from "../_components/LiveDataPanel";
import { ModeRejected } from "../_components/ModeRejected";
import { OfficialEvidencePanel } from "../_components/OfficialEvidencePanel";
import { parseEvidenceSummary } from "../_lib/evidence";
import { DEMO_UNSUPPORTED_NUMBER_COMPANY_ID } from "../_lib/guardrail-demo";
import { UNSUPPORTED_MODE_REASON } from "../_lib/mode";

const html = (node: ReactElement) => renderToStaticMarkup(node);
// Visible text only, with HTML entities decoded for the few React escapes.
const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const official = parseEvidenceSummary(summary);

describe("OfficialEvidencePanel", () => {
  const out = text(html(<OfficialEvidencePanel state={official} />));

  it("shows the scenario, source reports and every official note verbatim", () => {
    expect(out).toContain(summary.scenario);
    for (const report of summary.source_reports) expect(out).toContain(report);
    for (const note of summary.notes) expect(out).toContain(note);
  });

  it("shows assessment, enrichment, outreach, citation, model-call, token and cost metrics", () => {
    for (const label of [
      "Assessed (scored)",
      "Enrichments used",
      "Outreach drafts",
      "Cited fact IDs",
      "Model calls",
      "Input tokens",
      "Output tokens",
      "Recorded model cost",
      "Simulated provider cost",
    ]) {
      expect(out).toContain(label);
    }
    expect(out).toContain(`$${summary.baseline.model_cost_usd}`);
    expect(out).toContain(`$${summary.improved.model_cost_usd}`);
    expect(out).toContain(`$${summary.improved.provider_cost_usd}`);
  });

  it("says 'not reported' for a metric only one run states, instead of inventing a value", () => {
    expect(summary.baseline).not.toHaveProperty("rejected_before_enrichment");
    expect(out).toContain("not reported");
  });

  it("explains assessed vs delivered and recorded vs simulated cost, using the file's cost basis", () => {
    expect(out).toContain("Assessed vs delivered");
    expect(out).toContain("does not report delivered counts");
    expect(out).toContain(summary.provider_cost_basis);
    expect(out).toContain("Not charged");
  });

  it("does not mention the synthetic demonstration's injected claim", () => {
    expect(out).not.toMatch(/inject/i);
    expect(out).not.toMatch(/demonstration/i);
  });

  it("shows no figures for an invalid file", () => {
    const invalid = html(<OfficialEvidencePanel state={parseEvidenceSummary({ scenario: "x" })} />);
    expect(invalid).toContain("Invalid evidence file");
    expect(invalid).not.toContain("<table");
  });
});

describe("LiveDataPanel", () => {
  it("shows a pending live-data evaluation with no figures while real_data is null", () => {
    const out = text(html(<LiveDataPanel state={official} />));
    expect(out).toContain("Pending");
    expect(out).toContain("has not been published");
    expect(out).toContain("not a substitute");
    expect(out).not.toMatch(/\d/);
  });

  it("shows no figures even when real_data is present", () => {
    const withData = parseEvidenceSummary({ ...summary, real_data: { improved: { assessed: 7 } } });
    const out = text(html(<LiveDataPanel state={withData} />));
    expect(out).toContain("does not display them yet");
    expect(out).not.toMatch(/\d/);
  });
});

describe("DemoNotice", () => {
  const out = text(html(<DemoNotice companyId={DEMO_UNSUPPORTED_NUMBER_COMPANY_ID} />));

  it("labels the demonstration honestly", () => {
    expect(out).toContain("not an official evaluation run");
    expect(out).toContain("deliberately injects an unsupported numerical claim");
    expect(out).toContain("actual claim check finds it and suppresses that outreach");
    expect(out).toContain("not part of the official fixture evidence");
    expect(out).toContain(String(DEMO_UNSUPPORTED_NUMBER_COMPANY_ID));
  });

  it("does not claim the official improved run suppressed outreach", () => {
    expect(out).not.toMatch(/official (improved )?run (had|suppressed)/i);
  });
});

describe("ModeRejected", () => {
  it("explains the rejection and that nothing ran", () => {
    const out = html(<ModeRejected reason={UNSUPPORTED_MODE_REASON} />);
    expect(out).toContain("Mode not supported");
    expect(out).toContain("No pipeline was run");
    expect(out).toContain('href="/results"');
  });
});
