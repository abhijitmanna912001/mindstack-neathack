// The shared shell: homepage links, the data-source helper, the header's
// route-specific badge and the footer. Server-rendered; no network.

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The pathname usePathname reports. /live?preview=1 has the pathname /live.
let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
// next/font needs the Next.js compiler; the layout only reads the class name.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

import Home from "../page";
import RootLayout from "../layout";
import LivePage from "../live/page";
import { AppHeader } from "../_components/AppHeader";
import { DataModeSelector, LIVE_CRUSTDATA_HELPER } from "../_components/form/DataModeSelector";
import { HEADER_BADGE_LABELS, headerBadgeFor } from "../_lib/header-badge";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  pathname = "/";
});

const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const FOOTER =
  "SignalScout AI, neatHack 2026 prototype. Demo pages use synthetic data. Live Crustdata runs are invite only and switched off by default. Company data in live runs is provided by Crustdata.";

function layout(children: ReactNode): string {
  const props = { children, params: Promise.resolve({}) } as Parameters<typeof RootLayout>[0];
  return renderToStaticMarkup(RootLayout(props));
}

describe("homepage", () => {
  it("links to /results, unchanged, and to the live beta", () => {
    const markup = renderToStaticMarkup(<Home />);
    expect(markup).toMatch(
      /<a[^>]*href="\/results"[^>]*>See the results: official fixture evidence and a synthetic guardrail demo →<\/a>/,
    );
    expect(markup).toMatch(/<a[^>]*href="\/live"[^>]*>Try the invite-only live beta →<\/a>/);
  });

  it("puts the two links side by side in a row that wraps on narrow screens", () => {
    const markup = renderToStaticMarkup(<Home />);
    const row = markup.match(/<div class="([^"]*)"><a[^>]*href="\/results"[\s\S]*?href="\/live"/);
    expect(row).not.toBeNull();
    expect(row?.[1]).toContain("flex");
    expect(row?.[1]).toContain("flex-wrap");
  });
});

describe("data source selector", () => {
  const markup = () => renderToStaticMarkup(<DataModeSelector defaultValue="synthetic" />);

  // The <input> tag with the given value, whatever its attribute order.
  const radio = (html: string, value: string) =>
    html.match(/<input[^>]*>/g)?.find((tag) => tag.includes(`value="${value}"`)) ?? "";

  it("keeps Live Crustdata disabled", () => {
    expect(radio(markup(), "live")).toContain('disabled=""');
    expect(radio(markup(), "synthetic")).not.toContain("disabled");
    // Even when the form echoes back "live", the option stays disabled.
    expect(radio(renderToStaticMarkup(<DataModeSelector defaultValue="live" />), "live")).toContain('disabled=""');
  });

  it("shows the exact Live Crustdata helper text", () => {
    expect(LIVE_CRUSTDATA_HELPER).toBe(
      "Live runs are invite only and run on the Live beta page. They are switched off by default.",
    );
    expect(text(markup())).toContain(`Live Crustdata ${LIVE_CRUSTDATA_HELPER}`);
    expect(text(markup())).not.toContain("not enabled in this build");
  });
});

describe("header badge", () => {
  it.each([
    ["/", "Synthetic data mode"],
    ["/results", "Synthetic data mode"],
    ["/live", "Invite only beta"],
    // /live?preview=1: usePathname reports the pathname without the query.
    ["/live", "Invite only beta"],
  ])("on %s says %s", (path, label) => {
    pathname = path;
    const shown = text(renderToStaticMarkup(<AppHeader />));
    expect(shown).toContain(label);
    const other = label === HEADER_BADGE_LABELS.beta ? HEADER_BADGE_LABELS.synthetic : HEADER_BADGE_LABELS.beta;
    expect(shown).not.toContain(other);
  });

  it("maps routes to badges, including a query string the pathname leaves out", () => {
    expect(headerBadgeFor("/")).toBe("synthetic");
    expect(headerBadgeFor("/results")).toBe("synthetic");
    expect(headerBadgeFor("/live")).toBe("beta");
    expect(headerBadgeFor(new URL("http://localhost/live?preview=1").pathname)).toBe("beta");
    expect(headerBadgeFor("/live/anything")).toBe("beta");
    expect(headerBadgeFor("/lively")).toBe("synthetic");
    expect(headerBadgeFor(null)).toBe("synthetic");
  });

  it("follows client-side navigation, since it renders from the current pathname", () => {
    pathname = "/";
    expect(text(renderToStaticMarkup(<AppHeader />))).toContain("Synthetic data mode");
    pathname = "/live";
    expect(text(renderToStaticMarkup(<AppHeader />))).toContain("Invite only beta");
    pathname = "/results";
    expect(text(renderToStaticMarkup(<AppHeader />))).toContain("Synthetic data mode");
  });
});

describe("layout", () => {
  it("shows the shared footer wording", () => {
    const shown = text(layout(<main>page</main>));
    expect(shown).toContain(FOOTER);
    expect(shown).not.toContain("no live provider calls are made");
  });

  it("renders the header badge for the current route on every page", () => {
    pathname = "/live";
    expect(text(layout(<main>page</main>))).toContain("Invite only beta");
    pathname = "/results";
    expect(text(layout(<main>page</main>))).toContain("Synthetic data mode");
  });

  // The results page imports "server-only", which only resolves inside
  // Next.js; its badge and footer are covered by the tests above.
  it("wraps the homepage and both live modes", async () => {
    pathname = "/";
    const home = layout(<Home />);
    expect(text(home)).toContain("Try the invite-only live beta");
    expect(text(home)).toContain("Synthetic data mode");

    pathname = "/live";
    const live = layout(await LivePage({ searchParams: Promise.resolve({}) }));
    expect(live).toContain('id="live-code"');
    expect(live).not.toContain('id="live-preview-scenario"');
    expect(text(live)).toContain("Invite only beta");

    const preview = layout(await LivePage({ searchParams: Promise.resolve({ preview: "1" }) }));
    expect(preview).toContain('id="live-code"');
    expect(preview).toContain('id="live-preview-scenario"');
    expect(text(preview)).toContain("Invite only beta");
    expect(text(preview)).toContain(FOOTER);
  });
});
