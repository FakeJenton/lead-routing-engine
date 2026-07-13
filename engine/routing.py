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

import json

import config
import matching
import scoring
from taxonomy import region_for_state, segment_for_size


def route_lead(lead, account_index, pool):
    account, method, confidence = matching.match_lead(lead, account_index)
    score, band, behavior, breakdown = scoring.score_lead(lead)

    # Segment/region for pool routing come from the lead's own firmographics.
    segment = segment_for_size(lead["employee_count"] or 1)
    region = lead["region"] or region_for_state(lead["state"], lead["country"])

    decision = {
        "lead_id": lead["lead_id"],
        "matched_account_id": account["account_id"] if account else None,
        "match_method": method,
        "match_confidence": confidence,
        "score": score,
        "score_band": band,
        "score_breakdown": json.dumps(breakdown),
        "segment": segment,
        "region": region,
        "rule_fired": None,
        "assigned_rep_id": None,
        "status": None,
        "reason": None,
        "manual_override": 0,
    }

    def rep_name(rid):
        rep = pool.reps.get(rid)
        return rep["name"] if rep else rid

    band_word = {"A": "Hot", "B": "Warm", "C": "Cool", "D": "Cold"}.get(band, band)

    # --- Owner-based rules (only when we matched an owned account) ---
    if account and account["owner_rep_id"]:
        owner = account["owner_rep_id"]
        last_touch = account["last_activity_days"]

        # Owner-based routes are relationship continuity, not round-robin, so
        # they are recorded but do not consume a rep's round-robin capacity.
        if account["is_customer"]:
            decision.update(rule_fired="existing_customer_expansion",
                            assigned_rep_id=owner, status="routed",
                            reason=f"This company is already a customer, so the lead went "
                                   f"straight to {rep_name(owner)}, who owns the relationship.")
            return decision

        if account["has_open_opp"]:
            decision.update(rule_fired="open_opportunity",
                            assigned_rep_id=owner, status="routed",
                            reason=f"There is already an active deal with this company, so the "
                                   f"lead went to {rep_name(owner)}, who is working that deal.")
            return decision

        if last_touch is not None and last_touch <= config.RESTING_PERIOD_DAYS:
            decision.update(rule_fired="active_ownership",
                            assigned_rep_id=owner, status="routed",
                            reason=f"{rep_name(owner)} worked this account {last_touch} days ago, "
                                   f"within the {config.RESTING_PERIOD_DAYS}-day ownership window, "
                                   f"so the lead stays with them.")
            return decision

        # Owned, but past the resting period: fall through to the pool.
        stale_note = (f"The previous owner ({rep_name(owner)}) had not touched this account "
                      f"in {last_touch} days, past the {config.RESTING_PERIOD_DAYS}-day window, "
                      f"so it went back into the shared pool. ")
    else:
        stale_note = ""

    # --- Net-new / stale-owner: score-driven pool routing ---
    if behavior == "nurture":
        decision.update(rule_fired="nurture_low_score", status="nurture",
                        reason=f"{stale_note}Scored {score} out of 100 ({band_word}), too low to "
                               f"send to a rep right now. Added to the nurture list for "
                               f"automated follow-up.")
        return decision

    prefer_senior = (behavior == "prioritize_senior")
    rep_id, assign_reason = pool.assign(segment, region, prefer_senior=prefer_senior)

    if rep_id is None:
        decision.update(rule_fired="unrouted_no_capacity", status="unrouted",
                        reason=f"{stale_note}Every {segment} rep in the {region} region is at "
                               f"their lead limit, so this lead is stuck waiting. A manager "
                               f"needs to step in.")
        return decision

    if assign_reason == "senior_preferred_in_queue":
        how = f"scored {score} out of 100 (Hot), so it went to a senior rep"
    elif assign_reason == "region_overflow":
        how = (f"scored {score} out of 100 ({band_word}); its home region team was full, "
               f"so it was sent to another region's team")
    else:
        how = (f"scored {score} out of 100 ({band_word}) and was shared fairly across "
               f"the team")
    decision.update(rule_fired=f"pool_{assign_reason}",
                    assigned_rep_id=rep_id, status="routed",
                    reason=f"{stale_note}New {segment} lead {how}. "
                           f"Assigned to {rep_name(rep_id)}.")
    return decision
