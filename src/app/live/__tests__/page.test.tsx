// The /live page: the real form by default, preview mode only at
// /live?preview=1. Server-rendered; no network.

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import LivePage from "../page";
import { isPreviewRequest } from "../_lib/preview";

beforeAll(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in these tests.");
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

async function renderPage(query: Record<string, string | string[] | undefined>): Promise<string> {
  return renderToStaticMarkup(await LivePage({ searchParams: Promise.resolve(query) }));
}
const text = (markup: string) => markup.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("/live", () => {
  it("shows the real form by default, with no preview picker or preview banner", async () => {
    const markup = await renderPage({});
    expect(markup).toContain('id="live-code"');
    expect(markup).not.toContain('id="live-preview-scenario"');
    expect(text(markup)).toContain("Run search");
    expect(text(markup)).not.toContain("Run search (preview)");
    expect(text(markup)).not.toContain("Simulated responses only");
    expect(text(markup)).not.toContain("Not connected to live execution");
    expect(markup).toContain('href="/live?preview=1"');
  });

  it("explains synthetic demo codes and uses the eight-group example", async () => {
    const shown = text(await renderPage({}));
    expect(shown).toContain("Synthetic demo codes");
    expect(shown).toContain("ignores the industry, country and company size you submit and uses fixture data");
    expect(await renderPage({})).toContain('placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"');
  });

  it("shows preview mode at /live?preview=1, with the picker and the preview banner", async () => {
    const markup = await renderPage({ preview: "1" });
    expect(markup).toContain('id="live-code"');
    expect(markup).toContain('id="live-preview-scenario"');
    expect(text(markup)).toContain("Simulated responses only");
    expect(text(markup)).toContain("Live beta (preview mode)");
    expect(text(markup)).toContain("Run search (preview)");
    expect(text(markup)).not.toContain("Not connected to live execution");
  });

  it.each([["0"], ["true"], ["yes"], [""], [["1", "1"]]])("treats preview=%j as the real form", async (value) => {
    expect(isPreviewRequest(value)).toBe(false);
    expect(await renderPage({ preview: value })).not.toContain('id="live-preview-scenario"');
  });
});
