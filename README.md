# SignalScout

SignalScout is a prospecting agent that checks its data and its own claims before it spends money or writes outreach.

## What it does

Given an ideal customer profile (ICP), the agent runs these steps:

1. **ICP.** The ICP (industry, employee-count ranges, locations, keywords, excluded domains) becomes search filters and assessment criteria.
2. **Search.** It searches a company provider (synthetic fixtures, or Crustdata) up to a result cap.
3. **Validate and deduplicate.** Code rules check every record. Rejected records and later duplicates are dropped before any paid enrichment (improved pipeline).
4. **Enrich the best candidates within caps.** Valid records are enriched first, up to the enrichment cap.
5. **Build facts.** Each field becomes a fact with a status and a provider.
6. **Assess from facts only.** The model scores the company against the criteria using the facts it is given.
7. **Check claims.** Code checks the assessment and any outreach draft against the facts. Outreach that fails is suppressed.

Two pipelines exist: `baseline` (no pre-enrichment filtering, no guards) and `improved` (validation first, fact-based prompt, guards).

## Results

### Fixture runs

Source: `evidence/summary.json`. Scenario: Synthetic fixtures with known defects, claude-haiku at temperature 0, 10 searched and 5 enriched in both runs. Run labels: `baseline-final`, `improved-final`. Provider cost basis: simulated at measured Crustdata prices.

| Measure | Baseline | Improved |
|---|---|---|
| Enrichments | 5 | 5 |
| Wasted enrichments | 1 | 0 |
| Valid companies enriched | 2 | 3 |
| Assessed | 10 | 5 |
| Assessed, valid | 3 | 3 |
| Assessed, flagged | 5 | 2 |
| Assessed, should be rejected | 2 | 0 |
| Rejected before enrichment | n/a | 1 |
| Duplicates removed | n/a | 1 |
| Model calls | 10 | 5 |
| Tokens in | 5478 | 5052 |
| Tokens out | 2232 | 1167 |
| Model cost (USD) | 0.0183 | 0.012 |
| Provider cost (USD) | 3.69 | 3.69 |
| Outreach drafts | 8 | 5 |
| Cited fact ids | 22 | 13 |
| Cited, not citeable | 4 | 0 |
| Drafts with violations | 3 | 0 |
| Assessments failed | n/a | 0 |
| Outreach suppressed | n/a | 0 |
| Guard findings | n/a | 0 |

### Real data

Source: Crustdata live API, fake model (no model calls), neatlogs tracing off, same records for both pipelines.
Slice: Staffing and Recruiting, India, 11-50 and 51-200 employees, first 10 by company id ascending (6779 companies match the filters).

| Measure | Value |
|---|---|
| Searched | 10 |
| Enriched in both pipelines | 5 |
| Search-stage validation | valid 10, flagged 0, rejected 0 |
| After-enrichment validation | valid 7, flagged 3, rejected 0 |
| Changed by enrichment | valid to flagged: 3 |
| Rules fired | `size_headcount_mismatch:latest_headcount`: 3 |
| Baseline revalidates after enrichment | false |
| Improved assessed | valid 2, flagged 3 |
| Provider cost, measured, per run (USD) | 3.69 |

Caveat: Flagged by a zero-tolerance rule (headcount outside the stated size band by any amount). The magnitude of the mismatches has not been analysed, so this is a rule outcome, not proof that the data is wrong.

Notes:

- Zero suppressed outreach in a real run is not a guard catch: the guards verified every draft and found nothing to remove. The guards firing is shown by the deterministic cases and unit tests.
- Per assessment the improved prompt costs more (longer facts prompt); the total is lower because only enriched companies are assessed.

### Live data with the real model

Source: Crustdata live API and the real model (claude-haiku through the hackathon gateway), neatlogs tracing off, same records for both pipelines, company ids ascending.
Slice: Staffing and Recruiting, India, 11-50 and 51-200 employees, first 10 by company id ascending (6779 companies match the filters).

The same 10 live records were used for both pipelines. Each pipeline ran once, with tracing off. Only counts are reported, and company records are never stored.

Privacy: Real company profiles were sent to the model gateway in these runs. No company record is stored in the repository, in the run reports or in any trace.

Searched: 10. Enriched: 5. Validation after enrichment: valid 7, flagged 3, rejected 0. Provider cost, measured, per run (USD): 3.69.

| Measure | Baseline | Improved |
|---|---|---|
| Assessed | 10 | 5 |
| Assessed, valid | 7 | 2 |
| Assessed, flagged | 3 | 3 |
| Model calls | 10 | 5 |
| Tokens in | 8239 | 8300 |
| Tokens out | 3306 | 1870 |
| Model cost (USD) | 0.0272 | 0.0194 |
| Outreach drafts | 10 | 5 |
| Cited fact ids | 28 | 21 |
| Cited, not citeable | 4 | 0 |
| Drafts with violations | 4 | 0 |
| Guard warnings (uncertain fact reference) | n/a | 6 |
| Guard errors | n/a | 0 |
| Outreach suppressed | n/a | 0 |
| Assessments failed | n/a | 0 |

Notes:

- One run per pipeline on 10 live records, so this is a small sample, not a benchmark.
- The same three companies were flagged in both runs by a zero-tolerance size rule whose magnitude was not analysed (see the caveat in the live-data section).
- Cited but not citeable means the model cited a fact id that is not one of our fact ids for that company; it can mean an invented field or a different field name.
- Per assessment the improved prompt costs more; the total is lower because only enriched companies are assessed.

## How the guards work

### Validation rules (`src/core/data/validation.ts`)

Deterministic and pure. Each record gets a status of `valid`, `flagged` or `rejected`, with issues by code:

| Issue code | Meaning |
|---|---|
| `missing_name` | No company name. |
| `missing_domain` | No primary domain. |
| `junk_website` | Website is a messaging, link-shortener or social host (for example `wa.me`, `bit.ly`, `linktr.ee`). |
| `missing_linkedin` | No LinkedIn page. |
| `duplicate_domain` | Another company already uses the same domain (or the same LinkedIn page when there is no domain). The later record is the duplicate. |
| `size_headcount_mismatch` | Headcount is outside the listed employee range (field `latest_headcount`), or revenue with that headcount implies more than $500,000 per employee (field `revenue_range`). Zero tolerance. |

A record is `rejected` if it has no name, no domain and no LinkedIn page, or if it is a later duplicate. Any other issue makes it `flagged`. No issues means `valid`.

### Facts and statuses (`src/core/data/facts.ts`, `src/core/types.ts`)

Every fact carries a status, set by code only, and a provider.

- Statuses: `given` (reported by the provider), `extracted`, `cross_checked` (agrees with other facts, with `derived_from` ids), `uncertain` (conflicting or unsupported).
- Providers: `crustdata`, `fixture`, `user_input`, `derived`, `model`.

### The citeable rule

A fact may be cited only if its status is `given` or `cross_checked` and its provider is not `model` (`isCiteableFact`).

### validateAssessment and checkClaims (`src/core/agent/assessment-checks.ts`)

Neither calls a model and neither changes a fact's status.

- `validateAssessment` checks that `fit_score` and every criterion score are in 0 to 100, that each expected criterion is scored exactly once and nothing else is scored, and that every referenced fact id exists for the company. Referencing an `uncertain` fact is a warning.
- `checkClaims` checks an outreach draft. It must cite at least one fact. Every cited id must exist for the company, must not come from the model, and must have a citeable status. **Number check:** every number in the body must appear in a cited citeable fact, so an unknown figure cannot be stated as established (error code `unsupported_number`).

## Safety and spend controls

- **Caps.** `RunConfig` limits search results, enrichments, model calls per run (20) and output tokens per call (1500). The evidence runs use 10 searched and 5 enriched. Defaults are 100 and 15; the `dev` config uses 10 and 2.
- **Budget guard.** `BudgetGuard` is checked before every paid search and enrichment call in the Crustdata provider.
- **Spend flags.** The runner refuses `--provider crustdata` or `--llm real` without `--confirm-spend`, and checks that the needed key is present before anything is built.
- **Model usage limits.** The model-call count is the only per-run model usage cap, and the per-request output-token limit is also enforced. Dollar-denominated model spend caps and shared-key spend thresholds are not implemented: `src/core/agent/llm-policy.ts` states that both are "not yet agreed". The gateway key spend header is read and recorded, but nothing stops a run based on it.
- **Tracing is off for real-data runs.** `--trace on` with `--provider crustdata` is refused, and tracing is always off for Crustdata runs.
- **Reports hold counts and ids only.** Run reports in `runs/` contain counts, ids, costs, issue codes, tokens and timings. No company records, keys or headers.
- **Keys are never in the repo.** `.env` and `runs/` are git-ignored. Keys are read from environment variables.

## Run it

```bash
npm install
npm run dev          # Next.js dev server
```

Runner: `npx tsx scripts/run-pipeline.ts [flags]`

| Flag | Meaning |
|---|---|
| `--pipeline baseline\|improved` | Required. |
| `--llm fake\|real` | Default `fake`. `real` calls the LiteLLM gateway; needs `LITELLM_API_KEY` and `--confirm-spend`. |
| `--provider fixture\|crustdata` | Default `fixture`. `crustdata` needs `CRUSTDATA_API_KEY` and `--confirm-spend`. |
| `--confirm-spend` | Required with `--llm real` or `--provider crustdata`. |
| `--label <string>` | Run label. Default is the pipeline name. |
| `--config dev\|eval` | Default `eval` (10 searched, 5 enriched). `dev` is 10 searched, 2 enriched. |
| `--trace on\|off` | Fixture runs only. Default on for fixture runs. Needs `NEATLOGS_API_KEY` to send traces. |
| `--industry`, `--country`, `--sizes` | Crustdata runs only. Defaults: `Staffing and Recruiting`, `India`, `11-50,51-200`. |

Examples:

```bash
# Free: fixtures, fake model, no network
npx tsx scripts/run-pipeline.ts --pipeline baseline --trace off
npx tsx scripts/run-pipeline.ts --pipeline improved --label dry --trace off

# Costs model money: fixtures, real model through the gateway
npx tsx scripts/run-pipeline.ts --pipeline improved --llm real --confirm-spend --label improved-final

# Costs provider money: real Crustdata data, fake model, tracing always off
npx tsx scripts/run-pipeline.ts --pipeline improved --provider crustdata --confirm-spend \
  --industry "Staffing and Recruiting" --country India --sizes 11-50,51-200
```

Fixture versus Crustdata: fixture runs use synthetic records and simulate provider cost at measured prices (search 0.069 USD per record, enrichment 0.60 USD per company). Crustdata runs call the live API and spend real money.

Cost summary:

- No cost: `npm run dev`, `npm test`, fixture runs with the fake model.
- Costs model money: `--llm real`.
- Costs provider money: `--provider crustdata` (about 3.69 USD per run at the evaluation caps, measured).

Each run writes `runs/<timestamp>-<label>.json`.

## Results page

Run `npm run dev`, then open http://localhost:3000/results.

It shows:

- The official fixture evidence, read from `evidence/summary.json`.
- The live-data validation counts, with their caveat.
- A separate synthetic guardrail demonstration. A deterministic fake model injects an unsupported number into one outreach, and the claim check suppresses it.

Only synthetic mode is supported. Any other mode, for example `?mode=live`, is rejected on the server before anything is built. The page runs the real improved pipeline on fixtures with the fake model, makes no external calls and reads no environment variables. An import-guard test enforces this.

`evidence/summary.json` is bundled at build time, so rebuild or restart the dev server after editing it.

## Live beta (invite-only)

The page at `/live` takes an invite code and a small ICP form, and runs the improved pipeline for that code. The server routes are `POST /api/live/run` (a run) and `GET /api/live/status` (whether live mode is switched on).

### Status

This paragraph is the one place to edit when the facts change.

- The production deployment is at https://mindstack-neathack.vercel.app.
- Production now has the live variables configured (`CRUSTDATA_LIVE_API_KEY`, `LIVE_LLM_API_KEY`, `LIVE_LLM_BASE_URL`, `LIVE_LLM_MODEL`).
- Live mode stays off by default through the kill switch. It is switched on only for a builder-run test.
- After the first verified live run (below), every test code was disabled and the kill switch is off, so live mode is armed but closed.
- Only builder-only live codes can run live mode. None is enabled at the time of writing.
- Outsiders and judges get synthetic mode only.
- Third-party display of Crustdata records still waits for Crustdata's written confirmation.
- No company data from live runs is shown publicly. Demo evidence for live runs is limited to counts, costs and usage-page reconciliation.

### First verified live run

On 12 October 2026, around midday IST, one live run was made on the deployed site with a builder-only live code. The kill switch was on for the duration of the request and off again right after.

| Measure | Value |
|---|---|
| Status | completed |
| Companies searched | 10 |
| Enriched | 5 |
| Assessed | 5 |
| Assessments failed | 0 |
| Outreach drafts kept | 5 |
| Outreach drafts suppressed | 0 |
| Provider cost estimate | 3.69 USD (10 searched at 0.069 plus 5 enriched at 0.60, basis `estimated_per_record`) |
| Model cost estimate | 0.0195 USD (basis `estimated`, complete; flat fallback rates of 1.10 and 5.50 USD per million input and output tokens, as in `src/core/agent/llm-policy.ts`) |

- The `live_runs` table holds the same counts and costs and no company data.
- The model was `claude-haiku-4-5-20251001` through Anthropic's OpenAI-compatible endpoint. Anthropic documents that endpoint as intended for testing and comparing models, not as a long-term production solution.
- **Reconciliation of provider cost.** Crustdata's Usage page showed 12.3 credits used on 12 October 2026, the only usage that day (3.69 USD at 0.30 USD per credit). Its API Keys page showed the dedicated key's budget at 87.7 of 100 afterwards.
- **Model cost is our estimate only.** The model provider's own usage page was not checked.
- **Before the run.** A free probe with an industry that matches nothing was refused with `invalid_request` and gave the run back (the code's run counter stayed unchanged). This confirmed the live keys were active.
- **Earlier local check.** `scripts/check-live-model.ts` had first run the improved pipeline on the fixtures with the real model: 5 assessed, 0 failed, 5052 input and 1177 output tokens.
- **Deployed page.** Garvit tested the deployed /live page with a synthetic code and checked its layout on his phone.
- This is one run. It is not a benchmark.

### Modes

Each invite code is bound to one mode, set by whoever creates it (default `synthetic`).

- **synthetic.** Fixture companies and a fake model. The search criteria you enter are ignored (the response says so), and nothing is spent. One outreach draft deliberately contains an injected unsupported number so the claim check can be seen suppressing it.
- **live.** Real Crustdata data and a real model (`claude-haiku-4-5-20251001` through Anthropic's OpenAI-compatible endpoint in the first verified run), for the builders only. A live run searches up to 10 companies, enriches up to 5, and allows up to 20 model calls and 1500 output tokens per call. The search is sorted by company id ascending. The industry you type is matched to the first autocomplete suggestion from Crustdata, and the response says which industry was searched.

The form accepts an industry of 2 to 80 characters, the country India, and the sizes 11-50 and 51-200. Codes are up to 64 characters.

### How a run is protected

- **Hashed codes.** Codes are stored as HMAC-SHA256 hashes keyed with `INVITE_HMAC_SECRET` (at least 32 characters). Codes are normalised first (case, dashes and spaces ignored). Generated codes are 32 characters from a 160-bit random value.
- **One atomic reservation.** A run is reserved with a single conditional database update that increments the use count only if the code exists, is enabled, has runs left and is not locked.
- **One run at a time per code.** The reservation sets a lock that lasts 330 seconds. It is cleared when the run finishes or is given back. A second request while the lock is held gets `run_in_progress` (HTTP 409).
- **Give-back.** If a live run fails before the first paid call, the reservation is released and the run is not counted. A live run that fails after that is counted.
- **Per-IP rate limits.** 20 run requests per 60 seconds per IP. 5 wrong-code attempts per 900 seconds per IP (an unknown or disabled code counts). 60 status requests per 60 seconds per IP. IPs are stored only as HMAC hashes. Windows are fixed windows, not sliding.
- **Body limit.** A request body over 4096 bytes, a non-JSON content type or invalid JSON gets the fixed `invalid_request` body.
- **Fixed error bodies.** Every error response uses a fixed message chosen by status code. No thrown-error text, stack trace, key, code or upstream text is returned. Responses carry `Cache-Control: no-store`.
- **Scrubbing.** Free-text fields in a pipeline result (issue messages, failed-assessment messages, validation reasons, check findings, the run description) are replaced by fixed text chosen by code, once on the server and again when the results are mapped for the page.
- **Logging.** The application code does not log request bodies, invite codes or results. The hosting platform keeps its standard request logs (method, path and status), which we checked contain no bodies.
- **No company data stored by the application.** The application's database does not store company records. It holds invite codes (hash, label, run limits, mode), one row per run with counts and costs only, a settings table and rate-limit counters. This is about our storage only; company data does pass through external providers:

  - **Deployed live-beta requests.** The search filters and the LinkedIn URLs of the companies to enrich are sent to Crustdata, which returns the company profiles. Facts built from those returned profiles are sent to the configured model provider for assessment.
  - **Earlier CLI real-data evaluations.** In the runs described under "Live data with the real model", real company profiles were sent to the model gateway.

  As documented above, no company record is stored in the repository, in the run reports or in any neatlogs trace, and the live path does not use neatlogs. This README makes no claim about what Crustdata or the model provider retain.
- **Kill switch.** A `live_enabled` setting, off by default in the schema. While it is off, live-mode codes get `live_disabled` (HTTP 503) and the run is given back. Synthetic codes never read it. A live run is also refused when the live keys are not configured.
- **Tracing is off for real-data runs.** The live path does not use neatlogs.

### How costs are reported

Every run response carries a cost block.

- **Provider cost.** In synthetic mode it is simulated at fixture prices (`simulated_fixture_prices`). In live mode it is an estimate from the records searched and enriched at the measured per-record prices (`estimated_per_record`). It is never an invoice. The Crustdata usage page is the source of truth for charges.
- **Model cost.** `model_usd` is the known model cost only. `model_basis` says where the known costs came from: `none` (no external model cost, always so in synthetic mode), `gateway_reported`, `estimated` (from token usage at fallback rates), `mixed`, or `unavailable` (model calls were made but none has a known cost). `model_complete` is true only when every model call has a known cost; when it is false, `model_usd` is a lower bound. A model cost of 0 with basis `unavailable` means unknown, not free.

### Deployment

The deployment target is Vercel Hobby with a Neon Postgres database.

Environment variable names:

| Name | Needed for |
|---|---|
| `DATABASE_URL` | Required. Postgres connection for the live routes and the admin script. |
| `INVITE_HMAC_SECRET` | Required. At least 32 characters. Used for code and IP hashes. |
| `CRUSTDATA_LIVE_API_KEY` | Optional. Live mode only. |
| `LIVE_LLM_API_KEY` | Optional. Live mode only. |
| `LIVE_LLM_BASE_URL` | Optional. Live mode only. |
| `LIVE_LLM_MODEL` | Optional. Live mode only. When absent, the model in the code's live run config is used. |

Without `DATABASE_URL` and `INVITE_HMAC_SECRET` the routes answer `live_unavailable`. If any of the three optional variables is missing, live mode is off and synthetic codes still run. Production has the live keys configured. Live mode stays closed by the kill switch except during a builder-run test.

Setup:

1. Apply `src/server/live/schema.sql` to the database with any Postgres client. It is idempotent and can be applied more than once. It creates the tables and sets `live_enabled` to `false`.
2. Create codes and manage them with the admin script, which needs `DATABASE_URL` and `INVITE_HMAC_SECRET` in the environment. A new code is printed once, when it is created.

```bash
npx tsx scripts/live-admin.ts create --label <label> --runs <n> [--mode synthetic|live]
npx tsx scripts/live-admin.ts set-mode --label <label> --mode synthetic|live
npx tsx scripts/live-admin.ts list
npx tsx scripts/live-admin.ts disable --label <label>
npx tsx scripts/live-admin.ts enable --label <label>
npx tsx scripts/live-admin.ts add-runs --label <label> --n <n>
npx tsx scripts/live-admin.ts kill-switch on|off|status
```

`kill-switch off` stops live-mode codes; `kill-switch on` allows them (only if the live keys are also configured).

### Tested

- The latest reported full run of the unit suite is from the PR #10 change set: 808 passed and 6 skipped (`npx vitest run`, the same as `npm test`). The suite was not rerun on the current `main` commit for this README update. The 6 skipped tests are the six in `tests/live/pg-store.integration.test.ts`, which need `TEST_DATABASE_URL` (see the next item).
- An integration test (`tests/live/pg-store.integration.test.ts`) fires 20 parallel run reservations at one code on a managed Postgres and lets exactly one through; the other 19 get `run_in_progress`. It ran once, from a laptop, against a development branch of the managed database. It is skipped unless `TEST_DATABASE_URL` is set, which is why the suite reports one skipped file and 6 skipped tests (the file holds six tests). It runs in a throwaway schema that is dropped afterwards.

## Tests

```bash
npm test        # vitest run
npm run lint
```

Tests are in `tests/` (validation, facts, providers, runner metrics) and `tests/agent/` (pipelines, assessment checks, citation metrics, prompts, gateway client, cost handling). They make no network calls.

## Tools used

- **neatlogs** records traces of the fixture runs. The Markdown exports are in `evidence/traces/`.
- **Entire** records checkpoints of the work; the commit trailers are listed in `hackathon.md`.
- **cfo.ai** holds the business plan, a hypothetical model whose figures other than the measured unit costs are assumptions.
- **Crustdata** is the company data provider for search and enrichment.
- **LiteLLM gateway** is the OpenAI-compatible endpoint used for model calls.

## Repository layout

| Path | Contents | Primary contributors (approx., by commit history) |
|---|---|---|
| `src/app/` | Next.js frontend: ICP form, results | Garvit Mathur (mostly) |
| `src/core/agent/` | Pipelines, prompts, assessment checks, model clients | Garvit Mathur (mostly); Abhijit Manna for cost, tracing and metrics |
| `src/core/data/` | Validation, facts, providers, budget guard | Abhijit Manna |
| `src/core/fixtures/` | Synthetic companies | Abhijit Manna |
| `src/core/observability/` | neatlogs setup | Abhijit Manna |
| `scripts/` | Runner and smoke scripts | Abhijit Manna |
| `tests/` | Unit tests | Both; mostly Abhijit Manna |
| `evidence/` | `summary.json` and trace exports | Abhijit Manna |
| `runs/` | Local run reports (git-ignored) | n/a |

Ownership is taken from commit counts per folder, not from a formal assignment.

## Limitations

- The fixtures are synthetic.
- Provider cost in fixture runs is simulated at measured prices.
- The size rule has zero tolerance and the magnitude of the mismatches was not analysed.
- There is one scenario.
- The first live-data run used a fake model. A second pair of live runs used the real model through the hackathon gateway, which means real company profiles were sent to that gateway. Each is a single run on 10 companies.
- A neatlogs processing incident on Oct 11 was resolved the same day.
- No per-run model cost cap or shared-key spend threshold is enforced (see Safety and spend controls).
- Live beta: the per-run model cost cap and the key budget threshold are not implemented (same gap as above). A live run is bounded only by the call and record caps and the per-code run limit.
- Live beta: the first verified live run is a single run. The model cost is our estimate at flat fallback rates; the model provider's usage page was not checked. Anthropic documents its OpenAI-compatible endpoint as intended for testing and comparing models, not as a long-term production solution.
- Live beta: `claude-haiku-4-5-20251001` has a tentative retirement date not sooner than 15 October 2026, according to Anthropic's model status page as checked on 12 October 2026.
- Live beta: Anthropic's documentation says Claude 4.7 and later models return an error for a non-default temperature, and our client always sends temperature 0; claude-haiku-5-5 is a later model, so we expect it to be affected, but we did not test it.
- Live beta: there is no alerting and no admin UI. Codes and the kill switch are managed with the admin script.
- Live beta: the rate limit uses the first of `x-real-ip`, then `x-forwarded-for`. On Vercel the platform sets both and, per Vercel's request-headers documentation, overwrites `x-forwarded-for` to prevent spoofing. On any other host these headers could be spoofed.
- Run reports are local and not committed, so the numbers in `evidence/summary.json` cannot be re-derived from the repo alone.
- The Crustdata provider retries HTTP requests (up to 2 retries on 429, 5xx and network errors) inside its post method without rechecking the budget before each retry, so a retry after a lost response could repeat a billable call, up to three attempts for one chunk. We did not observe this: the Crustdata usage page matched our expected credits exactly after the real runs, but we did not log HTTP attempts. Budget checks happen once per logical operation (before each search and before each enrichment chunk).

## Team

Abhijit Manna, Garvit Mathur.
