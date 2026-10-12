// Server-rendered output of the live page's form, outcome states and
// notices. Static rendering only: no network, no browser.

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CODE_PLACEHOLDER,
  LiveFormView,
  type LiveFormViewProps,
  SYNTHETIC_CODE_NOTE,
} from "../_components/LiveFormView";
import { BetaNotices, PreviewBanner } from "../_components/LiveNotices";
import { LiveOutcome } from "../_components/LiveOutcome";
import { LivePreview } from "../_components/LivePreview";
import { LIVE_RUN_ERROR_CODES, SYNTHETIC_NOTICES } from "../_lib/contract";
import { buildPreviewFixtures } from "../_lib/fixtures";
import { ERROR_PRESENTATION, SERVER_FIELD_ERROR } from "../_lib/messages";
import type { PreviewFixtures } from "../_lib/preview";
import { serverFieldErrors, viewStateFor, type LiveViewState } from "../_lib/submission";
import { EMPTY_LIVE_FORM, validateLiveForm } from "../_lib/validation";

let fixtures: PreviewFixtures;
beforeAll(async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
  fixtures = await buildPreviewFixtures();
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const html = (node: ReactElement) => renderToStaticMarkup(node);
const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const noop = () => {};

function formProps(overrides: Partial<LiveFormViewProps> = {}): LiveFormViewProps {
  return {
    values: EMPTY_LIVE_FORM,
    errors: {},
    submitting: false,
    scenario: "success",
    onCodeChange: noop,
    onIndustryChange: noop,
    onSizeChange: noop,
    onScenarioChange: noop,
    onSubmit: noop,
    ...overrides,
  };
}

const outcome = (state: LiveViewState) => html(<LiveOutcome state={state} preview onBack={noop} onRetry={noop} />);

describe("form", () => {
  const out = html(<LiveFormView {...formProps()} />);

  it("labels every field accessibly", () => {
    for (const [id, label] of [
      ["live-code", "Invitation code"],
      ["live-industry", "Industry"],
      ["live-country", "Country"],
    ]) {
      expect(out).toContain(`for="${id}"`);
      expect(out).toContain(`id="${id}"`);
      expect(out).toContain(label);
    }
    expect(out).toContain("<legend");
    expect(out).toContain("Company size");
  });

  it("limits the code to 64 characters and the industry to 80", () => {
    expect(out).toMatch(/id="live-code"[^>]*maxLength="64"|maxLength="64"[^>]*id="live-code"/);
    expect(out).toMatch(/id="live-industry"[^>]*maxLength="80"|maxLength="80"[^>]*id="live-industry"/);
  });

  it("shows the eight-group code format as an example placeholder", () => {
    expect(CODE_PLACEHOLDER).toBe("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX");
    expect(CODE_PLACEHOLDER.split("-")).toEqual(Array(8).fill("XXXX"));
    expect(CODE_PLACEHOLDER.length).toBeLessThanOrEqual(64);
    expect(out).toMatch(/<input[^>]*id="live-code"[^>]*placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"/);
    expect(out).not.toContain("XXXXX");
    // An example only: a code in that format passes the 64-character rule.
    expect(validateLiveForm({ code: "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ12-3456", industry: "IT", sizes: ["11-50"] }).ok).toBe(true);
  });

  it("never names its inputs, so a native submit cannot put the code in the URL", () => {
    expect(out).toContain('method="post"');
    expect(out).not.toMatch(/<(input|select|textarea)[^>]*\sname=/);
    expect(out).not.toContain('action="');
  });

  it("offers India as the only country", () => {
    const options = out.match(/<select[^>]*id="live-country"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(options.match(/<option/g)).toHaveLength(1);
    expect(options).toContain(">India</option>");
  });

  it("offers checkboxes for 11-50 and 51-200 only", () => {
    expect(out.match(/type="checkbox"/g)).toHaveLength(2);
    expect(out).toContain("11-50 employees");
    expect(out).toContain("51-200 employees");
  });

  it("shows validation messages next to their fields", () => {
    const check = validateLiveForm(EMPTY_LIVE_FORM);
    if (check.ok) throw new Error("expected errors");
    const withErrors = text(html(<LiveFormView {...formProps({ errors: check.errors })} />));
    expect(withErrors).toContain("Enter your invitation code.");
    expect(withErrors).toContain("Enter an industry of at least 2 characters.");
    expect(withErrors).toContain("Select at least one company size.");
    expect(html(<LiveFormView {...formProps({ errors: check.errors })} />)).toContain('aria-invalid="true"');
  });

  it("disables the button and fields while a run is in progress", () => {
    const busy = html(<LiveFormView {...formProps({ submitting: true })} />);
    expect(busy).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(busy).toContain('aria-busy="true"');
    expect(text(busy)).toContain("Running…");
    expect(busy).toMatch(/<fieldset[^>]*disabled=""/);
    expect(text(out)).toContain("Run search (preview)");
  });

  it("labels the preview response picker as preview-only", () => {
    expect(text(out)).toContain("Preview: simulated server response");
    expect(text(out)).toContain("no request is sent");
  });

  it("explains that synthetic-mode codes ignore the submitted ICP", () => {
    expect(text(out)).toContain(SYNTHETIC_CODE_NOTE);
    expect(SYNTHETIC_CODE_NOTE).toMatch(/synthetic-mode code/);
    expect(SYNTHETIC_CODE_NOTE).toMatch(/ignores the industry, country and company size you submit/);
  });

  it("marks the field an invalid request named", () => {
    expect(serverFieldErrors({ kind: "error", code: "invalid_request", field: "industry" })).toEqual({
      industry: SERVER_FIELD_ERROR,
    });
    expect(serverFieldErrors({ kind: "error", code: "invalid_request", field: "icp" })).toEqual({});
    expect(serverFieldErrors({ kind: "error", code: "invalid_code" })).toEqual({});
    const marked = html(<LiveFormView {...formProps({ errors: { industry: SERVER_FIELD_ERROR } })} />);
    expect(text(marked)).toContain(SERVER_FIELD_ERROR);
  });
});

describe("outcome states", () => {
  it("renders nothing before a submission", () => {
    expect(outcome({ kind: "idle" })).toBe("");
  });

  it("renders a loading state that says nothing is being searched", () => {
    const out = outcome({ kind: "loading" });
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-busy="true"');
    expect(text(out)).toContain("Running…");
    expect(text(out)).toContain("nothing is being searched");
  });

  it.each(LIVE_RUN_ERROR_CODES)("renders the %s error with a way to recover", (code) => {
    const out = outcome({ kind: "error", code });
    const presentation = ERROR_PRESENTATION[code];
    expect(out).toContain('role="alert"');
    expect(text(out)).toContain(presentation.title);
    expect(text(out)).toContain(presentation.recovery);
    expect(text(out)).toContain("Simulated response");
    expect(text(out)).toMatch(/Edit the form|Back to the form/);
    if (presentation.action === "retry") expect(text(out)).toContain("Try again");
    else expect(text(out)).not.toContain("Try again");
  });

  it("names the specific states clearly", () => {
    const titles = Object.fromEntries(LIVE_RUN_ERROR_CODES.map((c) => [c, text(outcome({ kind: "error", code: c }))]));
    expect(titles.invalid_code).toContain("Invitation code not recognised");
    expect(titles.no_runs_left).toContain("No runs left");
    expect(titles.run_in_progress).toContain("already in progress");
    expect(titles.rate_limited).toContain("Too many requests");
    expect(titles.live_disabled).toContain("switched off");
    expect(titles.live_unavailable).toContain("Live mode unavailable");
    expect(titles.budget_exhausted).toContain("budget used up");
    expect(titles.run_failed).toContain("The run failed");
  });

  it("renders success with the shared prospect cards, labelled as synthetic preview data", () => {
    const out = text(outcome(viewStateFor(fixtures.success)));
    const { run } = fixtures.success.results;
    expect(out).toContain("Results");
    expect(out).not.toContain("Partial results");
    expect(out).toContain("Synthetic preview data, not a live result");
    expect(out).toContain(`Runs remaining on this invitation: ${fixtures.success.usage.runsRemaining} (a made-up preview value)`);
    expect(out).toContain(`Companies searched ${run.counts.searched}`);
    expect(out).toContain(`Enriched ${run.counts.enriched}`);
    expect(out).toContain(`$${run.cost.provider_usd.toFixed(2)}, simulated from fixture per-record prices`);
    expect(out).toContain("Demo run summary");
    expect(out).toContain("Demo run guardrail metrics");
    for (const notice of fixtures.success.notices) expect(out).toContain(notice);
    for (const p of fixtures.success.results.prospects) {
      expect(out).toContain(p.display_name);
      expect(out).toContain(`ID ${p.company_id}`);
    }
    expect(out).toContain("not a guarantee of company-data accuracy");
  });

  it("shows the demo-data banner and both synthetic notices prominently", () => {
    const markup = outcome(viewStateFor(fixtures.success));
    const out = text(markup);
    expect(out).toContain("Demo data (synthetic)");
    expect(out).not.toContain("Live Crustdata data");
    const notices = markup.match(/<ul aria-label="Synthetic demo notices"[\s\S]*?<\/ul>/)?.[0] ?? "";
    for (const notice of SYNTHETIC_NOTICES) expect(text(notices)).toContain(notice);
    // The banner and the notices come before the summary and the cards.
    expect(out.indexOf("Demo data (synthetic)")).toBeLessThan(out.indexOf("Demo run summary"));
    expect(out.indexOf(SYNTHETIC_NOTICES[0])).toBeLessThan(out.indexOf("Demo run summary"));
  });

  it("says the user's search criteria were not used in synthetic mode", () => {
    const out = text(outcome(viewStateFor(fixtures.success)));
    expect(out).toContain("your search criteria were not used");
  });

  it("names the field an invalid request rejected, and how long to wait when rate limited", () => {
    expect(text(outcome({ kind: "error", code: "invalid_request", field: "industry" }))).toContain(
      "Check this field: Industry.",
    );
    expect(text(outcome({ kind: "error", code: "invalid_request", field: "unknown_field" }))).not.toContain(
      "Check this field",
    );
    expect(text(outcome({ kind: "error", code: "rate_limited", retryAfterSeconds: 30 }))).toContain(
      "You can try again in about 30 seconds.",
    );
    expect(text(outcome({ kind: "error", code: "rate_limited", retryAfterSeconds: 90 }))).toContain(
      "You can try again in about 2 minutes.",
    );
    expect(text(outcome({ kind: "error", code: "rate_limited" }))).not.toContain("You can try again in about");
  });

  it("renders partial results with the reasons they are incomplete", () => {
    const out = text(outcome(viewStateFor(fixtures.partial)));
    expect(out).toContain("Partial results");
    expect(out).toContain("these results are incomplete");
    for (const issue of fixtures.partial.results.issues) expect(out).toContain(issue.message);
    expect(out).toContain("Synthetic preview data, not a live result");
    for (const p of fixtures.partial.results.prospects) expect(out).toContain(p.display_name);
  });

  it("never claims a preview result is live", () => {
    for (const state of [viewStateFor(fixtures.success), viewStateFor(fixtures.partial)]) {
      const out = text(outcome(state));
      expect(out).not.toMatch(/(?<!not a )live result(?!s are)/i);
      expect(out).not.toMatch(/real model|live model evaluation/i);
    }
  });
});

describe("notices", () => {
  it("shows the frontend-preview-only notice", () => {
    const out = text(html(<PreviewBanner />));
    expect(out).toContain("Frontend preview only");
    expect(out).toContain("Not connected to live execution");
    expect(out).toContain("Nothing shown here is a live result");
  });

  it("shows the beta, sponsorship and accuracy notices", () => {
    const out = text(html(<BetaNotices />));
    expect(out).toContain("Invite-only beta");
    expect(out).toContain("sponsored by the builders");
    expect(out).toContain("not a guarantee of company-data accuracy");
  });

  it("renders the interactive preview's initial form without a result", () => {
    const out = html(<LivePreview fixtures={fixtures} />);
    expect(out).toContain('id="live-code"');
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain("live-results-title");
  });
});
