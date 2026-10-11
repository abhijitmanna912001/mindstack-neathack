// Display format of the cost rows in the official fixture panel: model costs
// always show four decimal places; provider cost is shown as the file states
// it. The evidence values themselves are never changed.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import summary from "../../../../evidence/summary.json";
import { OfficialEvidencePanel } from "../_components/OfficialEvidencePanel";
import { parseEvidenceSummary } from "../_lib/evidence";

const html = renderToStaticMarkup(<OfficialEvidencePanel state={parseEvidenceSummary(summary)} />);

// The [baseline, improved] cells of the table row whose header is `label`.
function rowCells(label: string): [string, string] {
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((r) => r.includes(`>${label}</th>`));
  if (!row) throw new Error(`no row labelled ${label}`);
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].trim());
  expect(cells).toHaveLength(2);
  return [cells[0], cells[1]];
}

describe("official fixture panel cost formatting", () => {
  it("shows both model costs with exactly four decimal places", () => {
    expect(rowCells("Recorded model cost")).toEqual(["$0.0183", "$0.0120"]);
  });

  it("formats from the file's own values, which stay unchanged", () => {
    expect(rowCells("Recorded model cost")).toEqual([
      `$${summary.baseline.model_cost_usd.toFixed(4)}`,
      `$${summary.improved.model_cost_usd.toFixed(4)}`,
    ]);
    expect(summary.improved.model_cost_usd).toBe(0.012);
  });

  it("leaves the provider cost as the file states it", () => {
    expect(rowCells("Simulated provider cost")).toEqual(["$3.69", "$3.69"]);
    expect(rowCells("Simulated provider cost")).toEqual([
      `$${summary.baseline.provider_cost_usd}`,
      `$${summary.improved.provider_cost_usd}`,
    ]);
  });

  it("does not apply four decimals to other values", () => {
    expect(html).not.toContain("$3.6900");
    expect(rowCells("Model calls")).toEqual([String(summary.baseline.model_calls), String(summary.improved.model_calls)]);
  });
});
