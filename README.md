# SignalScout AI

**A B2B prospecting agent that checks its data, and its own claims, before it spends money or writes outreach.**

Built for neatHack 2026 by Abhijit Manna and Garvit Mathur.

| | |
|---|---|
| **Try it** | https://mindstack-neathack.vercel.app/live |
| **Demo video** | https://youtu.be/Xj1ummRLW-s |
| **Submission post (X)** | https://x.com/d07f53b74c0b417/status/2109672878870544625 |
| **Evidence page** | https://mindstack-neathack.vercel.app/results |
| **Business plan (cfo.ai)** | https://cfo.ai/s/FD45bXSO15ZacVmj |
| **Hackathon tools and proof** | [hackathon.md](hackathon.md) |

## Try it in 30 seconds

Open **/live**, paste a code, press **Run search**.

| Code | What it runs | Limit |
|---|---|---|
| `D0GS-0TN7-T87V-72SE-02HN-N68S-FM28-GY60` | The full pipeline on synthetic fixture companies with a fake model. Nothing is spent. Your search criteria are ignored (the page says so). One draft deliberately contains an invented number, so you can watch the claim check suppress it. | 100 runs |
| `TGKK-AZBH-5N5D-EJDG-Z8BZ-C5FG-GTDH-NFYB` | A real run: Crustdata search and enrichment, then a real model. 10 companies, about 30 to 60 seconds. Company data in live runs is provided by Crustdata. | 1 run, first come first served. If it says no runs left, contact us: abhijitmanna912001@gmail.com |

Live runs are invite only and sit behind a kill switch. Company data is shown in your browser only; our database stores counts and costs, never company records.

## The idea

Most prospecting tools spend first and check later: they pay to enrich junk records and write outreach that states things nobody verified. SignalScout does the checks first.

1. **Validate and deduplicate before paying.** Rejected records and duplicates never reach paid enrichment.
2. **Assess from facts only.** Every field becomes a fact with a status and a source. Only `given` or `cross_checked` facts can be cited.
3. **Check the claims.** Every number in an outreach draft must appear in a cited fact. If it does not, the draft is suppressed.

Pipeline: ICP, search, validate and deduplicate, enrich the best candidates within caps, build facts, assess, check claims.

## Does it work? Baseline vs improved

Same 10 records, same model (claude-haiku, temperature 0), one run per pipeline.

| Synthetic fixtures with known defects | Baseline | Improved |
|---|---|---|
| Wasted enrichments | 1 | 0 |
| Valid companies enriched | 2 | 3 |
| Companies assessed | 10 | 5 |
| Model calls | 10 | 5 |
| Model cost | $0.0183 | $0.0120 |
| Outreach drafts with citation violations | 3 | 0 |
| Cited facts that cannot be cited | 4 | 0 |

The same comparison on **10 real Crustdata records with the real model**: drafts with violations 4 vs 0, model cost $0.0272 vs $0.0194. On the real data, enrichment changed 3 of 5 companies from valid to flagged by a size rule, and only the improved pipeline re-validates after enrichment.

These are small samples, one scenario and one run each. They show the mechanism, not a benchmark. Full tables: [docs/DETAILS.md](docs/DETAILS.md).

**Verified live run on the deployed site (12 Oct 2026):** 10 searched, 5 enriched, 5 assessed, 0 failed. Provider cost estimate $3.69, which matches the 12.3 credits on Crustdata's usage page. Model cost estimate about $0.02 (our estimate; the model provider's usage page was not checked).

## Hackathon tools

| Tool | How we used it |
|---|---|
| **neatlogs** | Traces of the two official runs (`baseline-final`, `improved-final`). Markdown exports in [evidence/traces/](evidence/traces/). The improved trace shows the validation and guardrail spans. |
| **Entire** | Checkpoints on our Claude Code work. 36 `Entire-Checkpoint` trailers in the history at the time of writing. List and caveats in [hackathon.md](hackathon.md). |
| **cfo.ai** | [Business plan](https://cfo.ai/s/FD45bXSO15ZacVmj) built from measured unit costs: search $0.069 per record, enrichment $0.60 per company. Estimated contribution margin 60.10% at an assumed, unvalidated $40 per run. Excludes failed-job spend, tools and hosting, and salaries. |
| **Crustdata** | Company data for search and enrichment. Their team replied (informally, 12 Oct) that this invite-only use is fine and asked for an attribution line, which the live page shows. |

## What protects the spend (and what does not)

- Caps on records searched, enrichments and model calls; a budget guard before every paid call.
- Invite codes are stored as hashes; one run at a time per code; per-IP rate limits; a database kill switch that is off by default.
- No export or download feature, and at most 10 companies per run.
- Our database stores no company records. During a live run, search filters and LinkedIn URLs go to Crustdata, and facts from the results go to the model provider for scoring. We make no claim about what they retain.

## Honest limits

- Fixtures are synthetic, there is one scenario, and each result is a single run.
- Flagged companies come from a zero-tolerance size rule whose magnitude we did not analyse: a rule outcome, not proof that the data is wrong.
- Live costs are estimates. There is no dollar cap per run: the protection is the record and call caps, the per-code run limit and the Crustdata key's own budget.
- The model endpoint for live runs is Anthropic's OpenAI-compatible layer, which Anthropic documents as a testing layer. `claude-haiku-4-5` has a tentative retirement date not sooner than 15 October 2026.
- The home page form only records a profile. The pipeline runs on `/live` and `/results`.

Everything else, including the full limitations list, is in [docs/DETAILS.md](docs/DETAILS.md).

## Run it

```bash
npm install
npm run dev                       # http://localhost:3000, results at /results
npm test                          # 829 tests pass; 6 skip without a database
npx tsx scripts/run-pipeline.ts --pipeline improved --trace off   # free: fixtures, fake model
```

Runs that spend money need `--confirm-spend`; see [docs/DETAILS.md](docs/DETAILS.md#run-it).

## More

- [docs/DETAILS.md](docs/DETAILS.md): how the guards work, all tables, safety controls, live beta setup, tests, layout, full limitations
- [docs/BUILD_LOG.md](docs/BUILD_LOG.md): build log and the full Entire checkpoint table
- `evidence/`: `summary.json` and the neatlogs trace exports
