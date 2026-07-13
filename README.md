# Lead Routing Engine

**Live demo: https://lead-routing-engine.vercel.app**

A lead **scoring → matching → routing → monitoring** system, with a live
dashboard. It demonstrates the core primitives behind LeanData / Salesforce lead
routing (account matching, an ordered rule graph, resting periods, weighted
round-robin, guardrails, and an auditable trail) without needing either
platform. The synthetic data models a standard B2B SaaS pipeline, so the logic
transfers to any GTM motion.

## Two parts

| | What | Stack |
| --- | --- | --- |
| **`engine/`** | The routing engine: scores, matches, routes, and monitors leads, writing an auditable decision log. This is the substance. | Python standard library + SQLite |
| **root** | The dashboard: routing health, distribution, guardrail alerts, and an explorable audit trail. This is the shareable presentation layer. | Next.js + TypeScript |

The engine exports one static JSON snapshot
(`public/data/routing_snapshot.json`) that the dashboard renders client-side, so
the site deploys to Vercel with **no backend** and cannot break in a demo. This
mirrors how the role actually works: pipeline in code, surfaced to Sales
leadership in a clean view.

## Run the dashboard locally

```bash
npm install
npm run dev        # http://localhost:3000
```

## Re-run the engine and refresh the snapshot

```bash
cd engine
py main.py                 # route + print the digest and guardrail alerts
py export_snapshot.py      # regenerate ../public/data/routing_snapshot.json
```

Data is seeded (`RANDOM_SEED` in `engine/config.py`), so runs are reproducible.

## Deploy to Vercel

The repo root is a standard Next.js app, so Vercel deploys with zero config:

```bash
vercel            # preview
vercel --prod     # production
```

Or import the GitHub repo at vercel.com and accept the detected defaults. The
snapshot JSON is committed, so no build-time Python step is required.

## Where the logic lives

- Rule graph and precedence: [`engine/routing.py`](engine/routing.py)
- Account matching (domain → name → fuzzy): [`engine/matching.py`](engine/matching.py)
- Lead scoring: [`engine/scoring.py`](engine/scoring.py)
- Weighted round-robin: [`engine/assignment.py`](engine/assignment.py)
- Guardrails and digest: [`engine/monitor.py`](engine/monitor.py)
- Full routing documentation and signal dictionary: [`engine/docs/routing_logic.md`](engine/docs/routing_logic.md)

The dashboard's **Methodology** page is a web rendering of that same
documentation.
