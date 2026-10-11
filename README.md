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
- **Per-run model cost cap and shared-key spend threshold: not implemented.** `src/core/agent/llm-policy.ts` states that both are "not yet agreed". The gateway key spend header is read and recorded, but nothing stops a run based on it. The model-call count cap is the only model limit enforced.
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

| Path | Contents | Owner (by git history) |
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
- The real-data run used a fake model.
- A neatlogs processing incident on Oct 11 was resolved the same day.
- No per-run model cost cap or shared-key spend threshold is enforced (see Safety and spend controls).
- Run reports are local and not committed, so the numbers in `evidence/summary.json` cannot be re-derived from the repo alone.

## Team

Abhijit Manna, Garvit Mathur.
