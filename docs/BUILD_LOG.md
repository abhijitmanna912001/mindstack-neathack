This is the full build log and checkpoint table. The short version is ../hackathon.md.

# Hackathon notes

## Project

SignalScout: a prospecting agent that checks its data and its own claims before it spends money or writes outreach. See `docs/DETAILS.md`.

## Team

Abhijit Manna, Garvit Mathur.

## Stack

- Next.js 16.4.0, React 19.3.0, TypeScript, Tailwind
- Vitest for tests, tsx for scripts
- neatlogs for tracing, Entire for checkpoints
- Crustdata for company data
- LiteLLM gateway (OpenAI SDK) for model calls, model `claude-haiku`
- cfo.ai for the business plan
- Live beta: Postgres through `pg`, deployed on Vercel Hobby with a Neon Postgres database

## Build log

Times are IST (+05:30).

### Oct 10, 2026

- 16:18 and 16:19: Initial README and Entire setup, then a How it works section.
- 16:53: Added a checkpoint file.
- 19:19 and 19:22: Added the Next.js scaffold and core folder structure, and renamed the package to signalscout.
- 19:57 and 20:00: Added shared prospect types and ignored personal Claude Code settings.
- 20:10: Added the validation layer, synthetic fixtures and tests.
- 21:43 to 21:59: Built the ICP frontend shell, moved shared types to contract v1 (`Fact<T>`), added the provider interface, budget guard and fixture provider, and improved the frontend layout.
- 22:03 to 22:31: Added `buildFacts`, neatlogs tracing with a hello trace script, the openai SDK for the LiteLLM gateway, and removed an unused import.
- 22:36 and 23:04: Merged pull request #1 (frontend shell).

### Oct 11, 2026

- 09:04: Added the baseline agent pipeline. 09:53: merged pull request #2.
- 10:40: Added a run label, per-record fixture prices and the pipeline runner.
- 11:01 and 11:25: Added shared prompt safety rules and merged pull request #3.
- 12:47 to 13:04: Added prompt provenance and post-hoc validation metrics to the runner, added the improved pipeline, and changed it to prioritise valid prospects for enrichment.
- 13:19 and 13:27: Added the real Crustdata provider with budget guard, smoke script and tests, and merged pull request #4.
- 13:42: The runner can now run the improved pipeline and the Crustdata provider.
- 14:05 to 14:09: Reported outreach kept and citation metrics for both pipelines, added a final-record validation block to the runner, and added the evidence summary counts for the fixture runs.
- 15:06: Added the real-data counts to the evidence summary.
- 15:48: Added the neatlogs trace exports for the two official runs.
- 15:32 to 16:06: Built the results page at `/results` (synthetic mode only, official evidence from `evidence/summary.json`, live-data validation counts, guardrail demo), then merged pull request #5. Commits: [bb6452b](https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/bb6452bab1a28720bbe2e09d1d156c1d419a34cd) (build results UI), [d8a9ea1](https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/d8a9ea118d1c1e88bd9e0fda7d84301d1c2da4d1) (live-data evidence), [d47b31f](https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/d47b31f6a1c5ea6424571d058824c60de67da7af) (README and build log, Entire-Checkpoint 01M4N7QW6CQ23Y5C501EBFKH0B), merge [7f3642e](https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/7f3642e18c5c4045c473e2e4498a2b82eb0fb956). Only d47b31f carries an `Entire-Checkpoint` trailer; the other links are built from the sha and are not verified to open.
- Ran the baseline and improved pipelines once each on the same 10 live Crustdata records with the real model (claude-haiku through the hackathon gateway), tracing off. Real company profiles were sent to the gateway. The run reports are local and not committed.
- Added the counts from these live-data runs with the real model to `evidence/summary.json` (key `real_data_real_model`); they are written up in `docs/DETAILS.md`.
- 17:11 and 20:46: Formatted official model costs to four decimals, and handled a Crustdata 402 as an exhausted key budget.
- 22:17 and 22:20: Added the live-mode data layer (invite codes, atomic run reservation, kill switch) and a per-code mode (synthetic or live).
- 22:32 to 23:16: Added the invite-only live beta frontend preview, the live-mode orchestration with an injected results mapper (merged pull request #7), and the live-mode route handlers.

### Oct 12, 2026

- 00:04 and 00:22: Answered `live_disabled` when live is not configured, trimmed usage to `runsRemaining`, and added the live results DTO with a cost-aware summary (b9d50ff, merged as pull request #8 at 09:17).
- 09:22: Made the API runtime use the live-safe results mapper for both modes.
- Documented the live beta and the deployment in `docs/DETAILS.md`. The production deployment is on Vercel Hobby with a Neon Postgres database at https://mindstack-neathack.vercel.app. Live mode for third parties waits for Crustdata's written confirmation. (Superseded for the live keys by the entry below: production now has them configured.)
- Around midday IST: one verified live run on the deployed site with a builder-only live code. The kill switch was on for the request and off again right after. Result: completed; 10 searched, 5 enriched, 5 assessed, 0 assessments failed, 5 outreach drafts kept, 0 suppressed; provider cost estimate 3.69 USD (`estimated_per_record`); model cost estimate 0.0195 USD (`estimated`, complete, flat fallback rates). Model: `claude-haiku-4-5-20251001` through Anthropic's OpenAI-compatible endpoint, which Anthropic documents as intended for testing and comparing models, not as a long-term production solution. Crustdata's Usage page showed 12.3 credits used that day, the only usage (3.69 USD at 0.30 per credit), and the dedicated key's budget at 87.7 of 100. The model provider's usage page was not checked. A free probe with an industry that matches nothing was refused with `invalid_request` and gave the run back before the run. Afterwards every test code was disabled and the kill switch is off, so live mode is armed but closed. Garvit tested the deployed /live page with a synthetic code and checked its layout on his phone. Details are in the docs/DETAILS.md section "First verified live run".
- Before the live run: added and ran the model check script `scripts/check-live-model.ts`. It runs the improved pipeline on the fixtures with the real model through the configured endpoint, prints only counts and cost fields, and writes no files. Result: 5 assessed, 0 failed, 5052 input and 1177 output tokens.
- The unit suite last ran with 741 passed and 6 skipped. The skipped tests are the Postgres integration test, which runs only when `TEST_DATABASE_URL` is set; it ran once from a laptop against a development branch, with 20 parallel run reservations at one code and exactly one let through.
- Entire checkpoints: a few commits carry no `Entire-Checkpoint` trailer, including b9d50ff (a frontend pull request), fa6ebcb, e72f80e and adc3703, and several earlier ones. They are not in the checkpoint table below.
- After the live beta was deployed, Abhijit and Garvit tested the deployed site together on a video call (home page, results page, /live with a synthetic code, the preview mode, the network tab, a phone), and Garvit's homepage copy fixes (pull requests 12 and 13) were merged; the full suite then ran with 829 passed and 6 skipped.

## Evidence

| Item | Where | How to verify |
|---|---|---|
| 1. Run labels `baseline-final` and `improved-final` | `evidence/summary.json` | Compare the numbers below with the file. Run reports are kept local in `runs/` and are not committed, so the underlying reports cannot be checked from the repo. |
| 2. neatlogs traces | `evidence/traces/README.md`, `baseline-final-trace.md`, `improved-final-trace.md` | See below. |
| 3. Entire checkpoints | Links below | Open each link. Not verified from the repo. |
| 4. cfo.ai business plan | https://cfo.ai/s/FD45bXSO15ZacVmj | See below. |

### 1. Run numbers (from `evidence/summary.json`)

Scenario: Synthetic fixtures with known defects, claude-haiku at temperature 0, 10 searched and 5 enriched in both runs. Provider cost: simulated at measured Crustdata prices.

| Measure | baseline-final | improved-final |
|---|---|---|
| Enrichments | 5 | 5 |
| Wasted enrichments | 1 | 0 |
| Valid companies enriched | 2 | 3 |
| Assessed | 10 | 5 |
| Assessed, should be rejected | 2 | 0 |
| Model calls | 10 | 5 |
| Tokens in / out | 5478 / 2232 | 5052 / 1167 |
| Model cost (USD) | 0.0183 | 0.012 |
| Provider cost (USD) | 3.69 | 3.69 |
| Outreach drafts | 8 | 5 |
| Cited fact ids | 22 | 13 |
| Cited, not citeable | 4 | 0 |
| Drafts with violations | 3 | 0 |

The real-data section of the summary (Crustdata live API, fake model, tracing off) is in `docs/DETAILS.md`.

### 2. neatlogs traces

| Run label | Trace id (inside the run) | neatlogs page |
|---|---|---|
| baseline-final | a384edaa-bf31-4603-a597-d13d84384702 | https://app.neatlogs.com/traces/2656454332a37be4735a5ece62eb2145 |
| improved-final | 4733e92f-c8f2-4f3e-968b-f3b350a7df22 | https://app.neatlogs.com/traces/4716d3a09e7987c50643619aaffaed50 |

Caveat from `evidence/traces/README.md`: the trace pages have no Share button. Whether the page URLs open for people outside our project is not verified. The Markdown exports (`evidence/traces/baseline-final-trace.md` and `improved-final-trace.md`, from Download Markdown on the trace page) are the offline copy.

### 3. Entire checkpoints

Each commit below carries an `Entire-Checkpoint` trailer. Link format: `https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/<full sha>`.

| Short sha | Subject | Link |
|---|---|---|
| 720196e | Add final-record validation block to the runner | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/720196e403e7e8474ca0ae1476f9ef782a61cbc2 |
| 0edb808 | Report outreach kept and citation metrics for both pipelines | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/0edb808d312f5f8ef634b6d47da501f2db8e1b8a |
| 261ba83 | Run the improved pipeline and the Crustdata provider from the runner | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/261ba83e816c5507b7cdfddabe60864ea92bf13c |
| 2f2e339 | Add the real Crustdata provider with budget guard, smoke script and tests | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/2f2e339262c345f433ecaf7d79dfac0d9500f585 |
| 192e858 | feat: add improved SignalScout pipeline | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/192e858d5399f194b3e6bd9a1b3ade6328e7e027 |
| cb691fb | Add prompt provenance and post-hoc validation metrics to the runner | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/cb691fb8415e4c417efa0c36a42942d269ace29a |
| addf9d7 | feat: add shared prompt safety rules | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/addf9d79b8f93d7f7b812bc95e88acbb77c27a3c |
| efafb5f | Add run label, per-record fixture prices and the pipeline runner | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/efafb5f19bb5ea8fea008a362ce74671c87a7901 |
| d708e1b | feat: add SignalScout baseline agent pipeline | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/d708e1b5f8e6d760c06a92e81ad87bfa22dbe42d |
| af8352c | Add neatlogs tracing and hello trace script | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/af8352c6436a673c1f1bbd50aa46e659f32f31e7 |
| 9031e55 | Add buildFacts | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/9031e55b5d75b5ca1242984d6d72c876b1624f58 |
| 468ad3e | Improve SignalScout frontend layout | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/468ad3e35bb6db77c968ed152f0f71df7d5a9fe1 |
| 21ea760 | Add provider interface, budget guard and fixture provider | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/21ea76004001a0f73be683be2cbef0695b5da3a0 |
| d6d1a12 | Update shared types to contract v1 (Fact<T>) | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/d6d1a12c3382f1ce97852ff277e8747838482793 |
| e8fb34c | Build SignalScout ICP frontend shell | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/e8fb34c86e2e28bfd29def180f41f24c964983f2 |
| f907cac | Add validation layer, synthetic fixtures and tests | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/f907cac427580895ef32db30dc71180d2f5fef61 |
| d8ea169 | Ignore personal Claude Code settings | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/d8ea1693ee3868ce4cf5194a197a858d32362f03 |
| f9c9556 | Add shared prospect types | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/f9c9556f80354fb9d7f3321b6ba9966cc6917c02 |
| aeb3d6f | Add Garvit checkpoint file | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/aeb3d6f421711b3576a61583d11a4f5bc1245e38 |
| 1aa91c0 | Add How it works section | https://entire.io/gh/abhijitmanna912001/mindstack-neathack/commit/1aa91c05846c48b8f5ed864577ddc038edff1268 |

### 4. cfo.ai business plan

Share link: https://cfo.ai/s/FD45bXSO15ZacVmj

The measured unit costs are search 0.069 dollars per record and enrichment 0.60 dollars per company. Everything else in the plan, including the 40 dollar price per run and the 60 percent margin, is an assumption in a hypothetical model. It is not validated and cannot be verified from the repo.

## Demo

PENDING.

## Submission

- PENDING: a public quote post on X of the official neatlogs post, Monday Oct 12, 7:00 to 11:55 PM IST.
- PENDING: a demo video of 3 minutes or less covering neatlogs, Entire and cfo.ai.
