# Hackathon notes

**Project:** SignalScout AI, a prospecting agent that checks its data and its own claims before it spends money or writes outreach.
**Team:** Abhijit Manna, Garvit Mathur.
**Try it:** https://mindstack-neathack.vercel.app/live (codes are in [README.md](README.md))
**Demo video:** https://youtu.be/Xj1ummRLW-s
**Submission post on X:** https://x.com/d07f53b74c0b417/status/2109672878870544625

## The three required tools, and where to verify them

| Tool | What we did | Proof |
|---|---|---|
| **neatlogs** | Traced the two official fixture runs. | Trace pages: [baseline-final](https://app.neatlogs.com/traces/2656454332a37be4735a5ece62eb2145), [improved-final](https://app.neatlogs.com/traces/4716d3a09e7987c50643619aaffaed50). The pages have no Share button, so whether they open outside our project is not verified. Offline copies: `evidence/traces/*.md`. |
| **Entire** | Worked with Claude Code under Entire checkpoints. | 36 `Entire-Checkpoint` trailers in the commit history at the time of writing (count them: `git log --format=%B \| grep -c '^Entire-Checkpoint:'`). Table with links: [docs/BUILD_LOG.md](docs/BUILD_LOG.md). A few commits carry none (for example b9d50ff, 43bac0e and 0ac151a, frontend pull requests whose sessions had diverged), and we did not add trailers by hand. |
| **cfo.ai** | Business plan from measured costs. | [Plan](https://cfo.ai/s/FD45bXSO15ZacVmj). Measured: search $0.069 per record, enrichment $0.60 per company. Everything else, including the $40 per run price and the 60.10% estimated contribution margin, is an assumption in a hypothetical model, and not validated. |

## Stack

Next.js, React, TypeScript, Tailwind, Vitest. Crustdata for company data. LiteLLM gateway for the evidence runs (`claude-haiku`); Anthropic's OpenAI-compatible endpoint for the live beta. Postgres on Neon and hosting on Vercel for the live beta.

## Timeline (IST)

- **10 Oct:** scaffold, validation layer and synthetic fixtures, shared contract types, provider interface and budget guard, ICP frontend shell, neatlogs tracing.
- **11 Oct:** baseline and improved pipelines, real Crustdata provider, two official evidence runs with traces, the results page, real-data runs with the real model, the live beta data layer.
- **12 Oct:** live beta routes, results DTO with cost reporting, deployment on Vercel and Neon, first verified live run, Crustdata reply and attribution, final copy fixes, demo and submission.

Full log: [docs/BUILD_LOG.md](docs/BUILD_LOG.md).

## Honest notes

- Evidence numbers are in `evidence/summary.json`. The run reports behind them are kept locally and are not committed, so the numbers cannot be re-derived from the repo alone.
- The first live-data comparison used a fake model; the second used the real model, so real company profiles were sent to the model gateway in those runs. Nothing is stored in the repo or in any trace.
- Crustdata's approval of the live beta is an informal message, not a signed agreement.
