"""
Lead scoring.

A transparent 0-100 score built from five weighted signal groups. It is
rules-based on purpose for v1: every point is explainable to a VP of Sales and
auditable after the fact, which matters more than a marginal lift in AUC when
the score is going to move real leads to real reps.

The score is a routing input, not a separate report. The router reads
`score` and `band` to decide whether a net-new lead jumps to a senior rep
(A-band), routes normally (B/C), or parks in nurture (D). Swapping this for a
logistic-regression model later only requires that `score_lead` keep returning
the same shape.
"""

import config


def _band(score):
    for band, lo, behavior in config.SCORE_BANDS:
        if score >= lo:
            return band, behavior
    return "D", "nurture"


def score_lead(lead):
    """lead is a sqlite3.Row or dict. Returns (score:int, band:str, behavior:str, breakdown:dict)."""
    w = config.SCORE_WEIGHTS
    breakdown = {}

    # 1. Source intent (0..1 from config) scaled by its weight.
    intent = config.SOURCE_INTENT.get(lead["lead_source"], 0.3)
    breakdown["source_intent"] = round(intent * w["source_intent"], 1)

    # 2. Seniority of the contact.
    seniority_scale = {"owner": 1.0, "director": 0.9, "manager": 0.6, "individual": 0.3}
    s = seniority_scale.get(lead["seniority"], 0.4)
    breakdown["seniority"] = round(s * w["seniority"], 1)

    # 3. Firmographic size (more locations = larger opportunity).
    loc = lead["num_locations"] or 1
    firmo = min(loc / 16.0, 1.0)          # saturates at Enterprise scale
    breakdown["firmographic"] = round(firmo * w["firmographic"], 1)

    # 4. Behavioral engagement: pages viewed + trial started.
    pages = lead["pages_viewed"] or 0
    behave = min(pages / 20.0, 1.0) * 0.6 + (0.4 if lead["trial_started"] else 0.0)
    breakdown["behavioral"] = round(behave * w["behavioral"], 1)

    # 5. Recency of engagement.
    days = lead["days_since_touch"] if lead["days_since_touch"] is not None else 60
    recency = max(0.0, 1.0 - days / 60.0)
    breakdown["recency"] = round(recency * w["recency"], 1)

    total = int(round(sum(breakdown.values())))
    total = max(0, min(100, total))
    band, behavior = _band(total)
    return total, band, behavior, breakdown
