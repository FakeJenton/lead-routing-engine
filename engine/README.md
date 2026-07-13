# Lead Routing Engine

A self-contained lead scoring, matching, routing, and monitoring system, built
to demonstrate the core primitives behind LeanData / Salesforce lead routing
without needing either platform. It scores inbound leads, matches them to a
known book of business, routes them through an ordered rule graph with
guardrails, and emits a monitored daily digest with alerting.

The synthetic data models a standard B2B SaaS pipeline: companies segmented by
employee count, contacts ranked by seniority, and intent signals spanning demo
requests through cold lists, so the logic transfers to any GTM motion.

## Why this exists

I could not stand up a LeanData sandbox, so I rebuilt its core primitives in
code to show I understand what the platform does under the hood, not just which
buttons to click. The hardest and most valuable parts of routing are the logic
(matching, rule precedence, resting periods, fair distribution) and the
operational discipline around it (guardrails, alerting, an audit trail you can
defend to Sales). Those are exactly what this project implements.

Everything runs on the Python standard library. No pip install, no API keys, no
external services. One command runs the whole pipeline.

## Quick start

```bash
py main.py              # generate synthetic data, route everything, print the digest
py main.py --no-gen     # reuse existing data, just re-route and re-report
```

Outputs:
- `data/routing.db` : SQLite database (leads, accounts, reps, routing_decisions)
- `data/daily_digest.txt` : the health digest, written each run
- console : digest, guardrail alerts, and a sample of the audit trail

## The routing decision tree

Leads are evaluated top to bottom. The first rule that fires wins. Each rule is
a guardrail against the ones beneath it (never round-robin a current customer to
a stranger; never take an active deal away from the rep working it).

```
inbound lead
   |
   v
[ match to account ]  domain -> normalized name -> fuzzy name (state-gated)
   |
   v
matched an OWNED account?
   |-- yes --> is it a current customer?          --> route to OWNER  (existing_customer_expansion)
   |           has an open opportunity?            --> route to OWNER  (open_opportunity)
   |           touched within resting period (90d)? --> route to OWNER  (active_ownership)
   |           owner inactive > 90d?               --> reset ownership, fall through to pool
   |
   v
net-new or stale-owner: SCORE decides
   |-- band D (cold) ------------------------------> nurture, no rep     (nurture_low_score)
   |-- band A (hot) -------------------------------> senior rep in queue (pool_senior_preferred)
   |-- band B / C ---------------------------------> round-robin in queue (pool_round_robin)
                                                       |
                                          queue exhausted? --> region overflow --> else UNROUTED (escalate)
```

Full rule definitions and the signal dictionary are in
[docs/routing_logic.md](docs/routing_logic.md). That file is written as the
institutional documentation a routing owner would maintain: the knowledge
infrastructure that makes routing a team asset instead of one person's memory.

## How the pieces fit

| Module | Responsibility |
| --- | --- |
| `config.py` | All tunable policy: rep roster, segment thresholds, territory map, resting period, capacity, scoring weights, guardrail thresholds. The engine code never hardcodes policy. |
| `generate_leads.py` | Synthetic B2B leads and accounts, with the edge cases that break naive routers (name variants, personal email, missing fields, international). |
| `scoring.py` | Transparent 0-100 lead score from five weighted signal groups. Feeds routing as an input. |
| `matching.py` | Lead-to-account matching: exact domain, exact normalized name, then state-gated fuzzy name. |
| `routing.py` | The ordered rule graph. Produces one decision per lead, each with the rule that fired and a human-readable reason. |
| `assignment.py` | Weighted, capacity-aware round-robin with ramping weights, senior preference, and region overflow. |
| `monitor.py` | Guardrails and the daily digest: distribution skew, speed-to-lead SLA, match rate, override rate, unrouted escalations, with Slack-style alerting. |
| `main.py` | Orchestrates generate -> score -> match -> route -> monitor. This is the job a scheduler runs unattended. |

## Design decisions worth calling out

**Matching is the hard part, so it gets three tiers.** Domain match is highest
confidence but useless for personal email (a gmail address tells you nothing
about which account someone belongs to), so those are excluded from domain
matching and fall back to name matching. Fuzzy name matching is gated by state,
because "Summit Consulting" exists in every state and name similarity alone
would create false positives that misroute expansion leads.

**Score is a routing input, not a separate report.** Hot (A-band) leads jump to
a senior rep in the queue. Cold (D-band) leads park in nurture instead of
burning a rep's capacity. The router only depends on the score interface, so the
rules-based scorer can be swapped for a statistical model without touching
routing.

**Owner continuity does not compete with round-robin.** Customer, open-opp, and
active-ownership routes are relationship continuity. They are recorded but do
not consume a rep's round-robin capacity, and they are excluded from skew
detection, because you cannot rebalance who owns an account. The skew guardrail
watches only the mechanism you actually control: native round-robin inside a
queue, on queues above a minimum volume so 3-vs-2 noise does not page anyone.

**Every decision is auditable.** `routing_decisions` stores the matched account,
match method and confidence, score and band, the rule that fired, and a plain
sentence explaining why. That is the difference between a routing system you can
defend to Sales and a black box.

## What this demonstrates

- **Lead scoring from intent, behavioral, and firmographic signals** ->
  `scoring.py` (source intent, seniority, firmographics, behavioral engagement,
  recency).
- **Lead routing and distribution logic with guardrails, alerting, monitoring**
  -> `routing.py` + `assignment.py` + `monitor.py`.
- **Automated recurring workflows (distribution checks, SLA diagnostics,
  resting-period enforcement)** -> `monitor.py` runs unattended; resting period
  is a first-class rule.
- **Knowledge infrastructure (routing docs, signal dictionaries, model
  documentation)** -> [docs/routing_logic.md](docs/routing_logic.md).
- **A workflow that runs without a human in the loop** -> `py main.py` on a
  scheduler generates the day's leads, routes them, writes the audit log, and
  posts the digest.

## Roadmap / next steps

- Replace the rules-based score with a logistic-regression or gradient-boosted
  model trained on closed-won/closed-lost, keeping the same score interface.
- Wire real speed-to-lead timestamps from lead-created and first-touch events
  instead of the current simulation.
- Add closed-loss tagging and connect-rate diagnostics by routed segment and
  source (the closed-loop analysis the role mentions).
- Map each rule in `routing.py` to its LeanData FlowBuilder node equivalent, so
  the doc doubles as a migration spec.
