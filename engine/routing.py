"""
The routing rule graph.

This is the decision tree LeanData's "routing graph" models visually, expressed
as ordered rules in code. Order matters: the first rule that fires wins, and
each rule is a guardrail against the ones below it. The sequence encodes a
policy every RevOps team recognizes:

  1. Existing customer  -> the owning rep keeps expansion. Never round-robin a
                           current customer to a stranger.
  2. Open opportunity   -> the rep already working the deal gets the new lead.
  3. Active ownership    -> account touched within the resting period stays with
                           its owner (continuity).
  4. Resting period met  -> ownership is stale; the account returns to the pool.
  5. Net-new             -> score decides: A-band jumps to a senior rep, D-band
                           parks in nurture, the rest round-robin normally.

Every path records which rule fired and a human-readable reason, so the audit
log answers "why did this lead go here?" for any single lead.
"""

import config
import matching
import scoring
from taxonomy import region_for_state, segment_for_locations


def route_lead(lead, account_index, pool):
    account, method, confidence = matching.match_lead(lead, account_index)
    score, band, behavior, breakdown = scoring.score_lead(lead)

    # Segment/region for pool routing come from the lead's own firmographics.
    segment = segment_for_locations(lead["num_locations"] or 1)
    region = lead["region"] or region_for_state(lead["state"], lead["country"])

    decision = {
        "lead_id": lead["lead_id"],
        "matched_account_id": account["account_id"] if account else None,
        "match_method": method,
        "match_confidence": confidence,
        "score": score,
        "score_band": band,
        "segment": segment,
        "region": region,
        "rule_fired": None,
        "assigned_rep_id": None,
        "status": None,
        "reason": None,
        "manual_override": 0,
    }

    # --- Owner-based rules (only when we matched an owned account) ---
    if account and account["owner_rep_id"]:
        owner = account["owner_rep_id"]
        last_touch = account["last_activity_days"]

        # Owner-based routes are relationship continuity, not round-robin, so
        # they are recorded but do not consume a rep's round-robin capacity.
        if account["is_customer"]:
            decision.update(rule_fired="existing_customer_expansion",
                            assigned_rep_id=owner, status="routed",
                            reason=f"Matched existing customer {account['account_id']} "
                                   f"via {method}; routed to owner {owner} for expansion.")
            return decision

        if account["has_open_opp"]:
            decision.update(rule_fired="open_opportunity",
                            assigned_rep_id=owner, status="routed",
                            reason=f"Matched account {account['account_id']} with an open "
                                   f"opportunity; routed to deal owner {owner}.")
            return decision

        if last_touch is not None and last_touch <= config.RESTING_PERIOD_DAYS:
            decision.update(rule_fired="active_ownership",
                            assigned_rep_id=owner, status="routed",
                            reason=f"Account {account['account_id']} last touched {last_touch}d "
                                   f"ago (<= {config.RESTING_PERIOD_DAYS}d resting period); "
                                   f"stays with owner {owner}.")
            return decision

        # Owned, but past the resting period: fall through to the pool.
        stale_note = (f"Account {account['account_id']} owner {owner} inactive "
                      f"{last_touch}d (> {config.RESTING_PERIOD_DAYS}d); ownership reset, "
                      f"returned to pool. ")
    else:
        stale_note = ""

    # --- Net-new / stale-owner: score-driven pool routing ---
    if behavior == "nurture":
        decision.update(rule_fired="nurture_low_score", status="nurture",
                        reason=f"{stale_note}Score {score} (band {band}) below routing "
                               f"threshold; parked in nurture, no rep assigned.")
        return decision

    prefer_senior = (behavior == "prioritize_senior")
    rep_id, assign_reason = pool.assign(segment, region, prefer_senior=prefer_senior)

    if rep_id is None:
        decision.update(rule_fired="unrouted_no_capacity", status="unrouted",
                        reason=f"{stale_note}No available rep in {segment}/{region} "
                               f"(all at capacity). Escalate.")
        return decision

    tag = "high-score A-band, " if prefer_senior else ""
    decision.update(rule_fired=f"pool_{assign_reason}",
                    assigned_rep_id=rep_id, status="routed",
                    reason=f"{stale_note}{tag}Net-new {segment}/{region} lead "
                           f"(score {score}, band {band}); assigned to {rep_id} "
                           f"via {assign_reason}.")
    return decision
