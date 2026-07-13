# Routing Logic Documentation

This is the institutional reference for how leads are scored, matched, and
routed. It is written to be maintained by whoever owns routing, so a new analyst
can understand and safely change the system without reading the source. When a
rule changes, this document changes with it.

Audience: RevOps, Sales leadership, and anyone who has ever asked "why did this
lead go to that rep?"

---

## 1. Routing dimensions

Every lead is placed on two dimensions, computed from its firmographics.

### Segment (primary)
Segment is measured by employee count, the most common firmographic
segmentation dimension in B2B SaaS. A 10-person shop and a 5,000-person
enterprise are entirely different sales motions.

| Segment | Employees | Notes |
| --- | --- | --- |
| SMB | 1 to 100 | Highest volume, fastest cycle, most reps. |
| MidMarket | 101 to 1,000 | Multi-team operators, longer cycles. |
| Enterprise | 1,001+ | Largest deals, senior reps only, deliberately thin bench. |

### Region (secondary)
US states roll up to West, Central, or East. Anything non-US is INTL.
See `US_REGIONS` in `config.py` for the exact state map. Reps own a
`(segment, region)` queue.

---

## 2. Matching logic

Goal: decide whether an inbound lead belongs to an account we already know.
Matching runs in confidence order and stops at the first hit.

| Tier | Method | Confidence | Notes |
| --- | --- | --- | --- |
| 1 | Exact corporate domain | 1.00 | Skipped for personal email domains (gmail, yahoo, etc.), which carry no account signal. |
| 2 | Exact normalized name | 0.95 | "Acme Labs, Inc." and "acme labs" both normalize to "acme labs". |
| 3 | Fuzzy normalized name | 0.88 to 0.96 | Accepted only when state agrees, or when similarity is near-perfect (>= 0.96). State gating suppresses false positives from common names. |

**Normalization** (see `normalize.py`): lowercase, strip punctuation, drop legal
suffixes (inc, llc, corp, co, ...), drop a leading "the", collapse whitespace.

**Why matching matters:** a missed match creates a duplicate account and
misroutes an expansion lead away from the owning rep. A false match hands a lead
to the wrong rep entirely. Both corrupt every downstream metric, so the matcher
is deliberately conservative on fuzzy matches.

---

## 3. The rule graph

Rules are evaluated in this exact order. The first that fires wins.

| # | Rule (rule_fired) | Condition | Action |
| --- | --- | --- | --- |
| 1 | `existing_customer_expansion` | Matched an owned account that is a current customer | Route to the account owner |
| 2 | `open_opportunity` | Matched an owned account with an open opportunity | Route to the deal owner |
| 3 | `active_ownership` | Matched an owned account touched within the resting period | Route to the owner (continuity) |
| 4 | (fall-through) | Matched an owned account, owner inactive beyond the resting period | Reset ownership, drop to the pool |
| 5 | `nurture_low_score` | Net-new or reset, score band D | Park in nurture, no rep |
| 6 | `pool_senior_preferred_in_queue` | Net-new or reset, score band A | Senior rep in the queue |
| 7 | `pool_round_robin_in_queue` | Net-new or reset, score band B or C | Round-robin in the queue |
| 8 | `pool_region_overflow` | Queue exhausted, same segment available elsewhere | Assign cross-region |
| 9 | `unrouted_no_capacity` | Nothing available | Mark unrouted, escalate |

### Resting period
Defined by `RESTING_PERIOD_DAYS` (currently 90). If an owned account was last
touched within this window, a new lead stays with the owner. Past it, ownership
is treated as stale and the lead returns to the pool for fresh round-robin. This
prevents leads from resting forever with a disengaged rep while preserving
continuity for active relationships.

---

## 4. Assignment logic (round-robin)

Once a lead is bound for a queue, `assignment.py` picks the rep using
**weighted least-loaded**: assign to whoever has the lowest load-to-weight
ratio. This self-corrects (skipped or capped reps naturally catch up) and needs
no stored rotation pointer.

Modifiers:
- **Capacity cap:** a rep at their active-lead ceiling is skipped.
- **Ramping weight:** new hires carry weight 0.5 so they receive proportionally
  fewer leads until ramped.
- **Senior preference:** band A leads prefer a senior rep in the queue.
- **Region overflow:** if the exact queue is exhausted, fall back to the same
  segment in another region before dropping the lead.

---

## 5. Signal dictionary (lead scoring)

Score is 0 to 100, from five weighted groups (`SCORE_WEIGHTS` in `config.py`).

| Signal group | Weight | Inputs | Rationale |
| --- | --- | --- | --- |
| Source intent | 30 | `lead_source` mapped through `SOURCE_INTENT` | A demo request signals far more intent than a newsletter signup. |
| Seniority | 20 | `seniority` of the contact (executive > director > manager > individual) | Executives and directors are the economic buyers. |
| Firmographic | 20 | `employee_count` (saturates at Enterprise scale) | A larger company means a larger deal. |
| Behavioral | 25 | `pages_viewed`, `trial_started` | Product engagement is the strongest near-term buying signal. |
| Recency | 5 | `days_since_touch` | Recent engagement is worth acting on now. |

### Score bands and routing behavior

| Band | Score | Behavior |
| --- | --- | --- |
| A | 75+ | Prioritize a senior rep in the queue |
| B | 50 to 74 | Standard round-robin |
| C | 30 to 49 | Standard round-robin |
| D | 0 to 29 | Nurture, no rep assigned |

The score is intentionally rules-based for v1: every point is explainable to a
VP and auditable per lead. See the roadmap in the README for the statistical
upgrade path.

---

## 6. Guardrails and monitoring

`monitor.py` reads the audit log and checks these each run. Breaches emit a
Slack-style alert (payload is printed; set `SLACK_WEBHOOK_URL` to POST for real).

| Guardrail | Threshold (config) | Fires when |
| --- | --- | --- |
| Distribution skew | 1.5x fair share, min queue volume 25 | A rep takes an unfair share of native round-robin in a queue. Owner and overflow routes are excluded because they cannot be rebalanced. |
| Speed-to-lead SLA | 5 minutes | Assignments slower than SLA are counted; alert if breach rate is high. |
| Unrouted escalation | 15 minutes | Any lead left unrouted (all reps at capacity). |
| Override rate | 10% | Manual re-route rate high enough to suggest the rules are wrong. |
| Match rate floor | 20% net-new max | Match rate low enough to suggest matching is failing. |

---

## 7. Data model

Four tables in `data/routing.db` (schema in `db.py`):

- **leads** : the inbound record, with firmographic, behavioral, and contact fields.
- **accounts** : the existing book of business, with owner, segment, customer
  status, open-opp flag, and last-activity age (drives the resting period).
- **reps** : the roster, with segment, region, capacity, ramping flag, seniority.
- **routing_decisions** : the audit log. One row per lead recording the matched
  account, match method and confidence, score and band, the rule that fired, the
  assigned rep, status, a plain-language reason, time in queue, and whether it
  was manually overridden.

Query the audit log directly, for example:

```sql
SELECT rule_fired, COUNT(*) FROM routing_decisions GROUP BY rule_fired ORDER BY 2 DESC;
SELECT * FROM routing_decisions WHERE status = 'unrouted';
SELECT reason FROM routing_decisions WHERE lead_id = 'L000456';
```
