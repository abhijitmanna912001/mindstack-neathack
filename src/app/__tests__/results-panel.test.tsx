// The homepage's results panel. The page records a profile only: it never
// runs the pipeline, so the accepted state must not claim results.
// Server-rendered; no network.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsPanel } from "../_components/results/ResultsPanel";
import type { IcpDraft } from "../_lib/icp-form";

const ICP: IcpDraft = {
  industry: "Staffing and recruiting",
  companySize: "51-200",
  locations: ["India"],
  keywords: ["contract hiring"],
  excludedDomains: [],
  mode: "synthetic",
};

const ACCEPTED =
  "Profile accepted. This page does not run the pipeline, so no results are generated here. Run it on the Live beta page with an invitation code, or see the saved evidence on the Results page.";
const INITIAL = "Define your ideal customer profile to start a run.";
const PENDING = "Checking your profile…";

const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1")
    .trim();

// The polite live region that holds the run status.
function status(markup: string): string {
  return markup.match(/<p aria-live="polite"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
}

describe("results panel, profile accepted", () => {
  const markup = renderToStaticMarkup(<ResultsPanel icp={ICP} pending={false} />);

  it("says the page does not run the pipeline, with the exact message", () => {
    expect(text(status(markup))).toBe(ACCEPTED);
    expect(text(markup)).not.toContain("pipeline is not connected yet");
  });

  it("links to the Live beta page and the Results page from the message", () => {
    const message = status(markup);
    expect(message).toMatch(/<a[^>]*href="\/live"[^>]*>Live beta page<\/a>/);
    expect(message).toMatch(/<a[^>]*href="\/results"[^>]*>Results page<\/a>/);
  });

  it("still shows the active profile, and no results", () => {
    expect(text(markup)).toContain("Active profile");
    expect(text(markup)).toContain(ICP.industry);
    expect(text(markup)).toContain("Scored prospects will appear here after a run.");
    for (const label of ["Companies found", "Qualified", "Average fit", "Drafts ready"]) {
      expect(text(markup)).toContain(`${label} —`);
    }
  });
});

describe("results panel, initial and pending states", () => {
  it("keeps the initial empty state", () => {
    const markup = renderToStaticMarkup(<ResultsPanel icp={null} pending={false} />);
    expect(text(status(markup))).toBe(INITIAL);
    expect(status(markup)).not.toContain("<a");
    expect(text(markup)).not.toContain("Active profile");
    expect(markup).not.toContain("animate-pulse");
  });

  it("keeps the pending state, which takes priority over an accepted profile", () => {
    for (const icp of [null, ICP]) {
      const markup = renderToStaticMarkup(<ResultsPanel icp={icp} pending />);
      expect(text(status(markup))).toBe(PENDING);
      expect(status(markup)).not.toContain("<a");
      expect(markup).toContain("animate-pulse");
    }
  });
});
