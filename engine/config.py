"""
Central configuration for the lead routing engine.

Everything a routing owner would tune lives here: the rep roster, segment
thresholds, territory map, resting period, capacity caps, ramping weights,
and the guardrail thresholds the monitor alerts on. Keeping it in one file
is deliberate. In a real org this is the "routing config" that changes weekly,
and it should never require touching the engine code.
"""

# ---------------------------------------------------------------------------
# Reproducibility
# ---------------------------------------------------------------------------
RANDOM_SEED = 42

# ---------------------------------------------------------------------------
# Volume for the synthetic generator
# ---------------------------------------------------------------------------
NUM_LEADS = 1000
NUM_ACCOUNTS = 600

# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------
# brightwheel sells to early-education providers, so account size is measured
# in number of centers/locations rather than pure employee count. A single
# in-home daycare is very different from a 40-site franchise.
#
# Segment is the primary routing dimension: reps specialize by segment.
SEGMENT_RULES = [
    # (segment_name, min_locations, max_locations)
    ("SMB", 1, 2),
    ("MidMarket", 3, 15),
    ("Enterprise", 16, 100000),
]

# ---------------------------------------------------------------------------
# Territory
# ---------------------------------------------------------------------------
# Territory is the secondary routing dimension. US states roll up to a region;
# anything outside the US is INTL. Reps own a (segment, region) queue.
US_REGIONS = {
    "West": {"CA", "WA", "OR", "NV", "AZ", "UT", "ID", "MT", "WY", "CO", "AK", "HI", "NM"},
    "Central": {"TX", "OK", "KS", "NE", "SD", "ND", "MN", "IA", "MO", "AR", "LA", "WI", "IL", "IN", "MI", "OH"},
    "East": {"ME", "NH", "VT", "MA", "RI", "CT", "NY", "NJ", "PA", "DE", "MD", "DC", "VA", "WV", "NC", "SC", "GA", "FL", "KY", "TN", "AL", "MS"},
}

# ---------------------------------------------------------------------------
# Resting period
# ---------------------------------------------------------------------------
# If an account was last touched by its owner within this window, a new lead
# from that account goes back to the same owner (continuity). Past this window,
# ownership is considered stale and the lead returns to the pool for fresh
# round-robin. This is the "resting period" the JD calls out by name.
RESTING_PERIOD_DAYS = 90

# ---------------------------------------------------------------------------
# Rep roster
# ---------------------------------------------------------------------------
# capacity      : max concurrent active leads before the rep is skipped
# is_ramping    : new hires receive a reduced share until fully ramped
# seniority     : "senior" reps are eligible to receive high-score (A-band) leads
#
# Ramping reps get a weight below 1.0 so the weighted-least-loaded assigner
# hands them proportionally fewer leads.
RAMPING_WEIGHT = 0.5
FULL_WEIGHT = 1.0

REPS = [
    # rep_id, name, segment, region, timezone, capacity, is_ramping, seniority
    ("R01", "Maya Chen",        "SMB",        "West",    "America/Los_Angeles", 40, False, "senior"),
    ("R02", "Devon Brooks",     "SMB",        "West",    "America/Los_Angeles", 40, True,  "junior"),
    ("R03", "Priya Nair",       "SMB",        "Central", "America/Chicago",     40, False, "senior"),
    ("R04", "Tomas Alvarez",    "SMB",        "Central", "America/Chicago",     40, False, "junior"),
    ("R05", "Grace Okafor",     "SMB",        "East",    "America/New_York",    40, False, "senior"),
    ("R06", "Liam Sullivan",    "SMB",        "East",    "America/New_York",    40, True,  "junior"),
    ("R07", "Hannah Weiss",     "MidMarket",  "West",    "America/Los_Angeles", 30, False, "senior"),
    ("R08", "Marcus Reid",      "MidMarket",  "Central", "America/Chicago",     30, False, "senior"),
    ("R09", "Sofia Romano",     "MidMarket",  "East",    "America/New_York",    30, False, "senior"),
    ("R10", "Nathan Cole",      "MidMarket",  "East",    "America/New_York",    30, True,  "junior"),
    ("R11", "Aisha Rahman",     "Enterprise", "West",    "America/Los_Angeles", 20, False, "senior"),
    ("R12", "Ben Carter",       "Enterprise", "East",    "America/New_York",    20, False, "senior"),
]

# Overflow: if no rep is available in the exact (segment, region) queue, allow
# assignment to the same segment in any region rather than dropping the lead.
ALLOW_REGION_OVERFLOW = True

# ---------------------------------------------------------------------------
# Lead scoring weights
# ---------------------------------------------------------------------------
# A transparent, rules-based score (0-100). Rules-based on purpose for v1: it is
# explainable to a VP and every point is auditable. A logistic-regression
# version is a documented next step (see README), but the routing engine only
# depends on the score interface, not how the score is produced.
SCORE_WEIGHTS = {
    "source_intent": 30,   # demo request > pricing view > content download
    "seniority":     20,   # owner/director > teacher
    "firmographic":  20,   # more locations = bigger deal
    "behavioral":    25,   # trial started, pages viewed
    "recency":       5,    # engaged recently
}

# Intent weight by lead source (0.0 - 1.0), multiplied into source_intent.
SOURCE_INTENT = {
    "demo_request":      1.00,
    "pricing_page":      0.85,
    "contact_sales":     0.90,
    "free_trial":        0.95,
    "webinar":           0.55,
    "content_download":  0.35,
    "newsletter":        0.20,
    "outbound_sequence": 0.50,
    "cold_list":         0.15,
}

# Score bands drive routing behavior for net-new leads.
SCORE_BANDS = [
    # (band, min_score, routing_behavior)
    ("A", 75, "prioritize_senior"),  # hot: prefer senior rep in queue
    ("B", 50, "standard"),
    ("C", 30, "standard"),
    ("D", 0,  "nurture"),            # cold: park in nurture, no rep assigned
]

# ---------------------------------------------------------------------------
# Guardrails / monitoring thresholds
# ---------------------------------------------------------------------------
# The monitor flags anything that breaches these and emits a (simulated) alert.
GUARDRAILS = {
    # Distribution fairness: flag a rep receiving more than this multiple of
    # their fair share within their queue. Only evaluated on round-robin
    # (pool) assignments, since owner continuity cannot be rebalanced.
    "skew_fair_share_multiple": 1.5,
    # Do not evaluate skew on thin queues, where 3-vs-2 is noise, not skew.
    "skew_min_queue_volume": 25,
    # Speed-to-lead SLA in minutes. Assignments slower than this breach SLA.
    "sla_minutes": 5,
    # A lead unrouted longer than this is escalated.
    "unrouted_escalation_minutes": 15,
    # If more than this fraction of routed leads were manually overridden, the
    # rules are probably wrong and need review.
    "override_rate_alert": 0.10,
    # If net-new (unmatched) leads exceed this fraction, matching may be failing.
    "min_match_rate_alert": 0.20,
}

# Simulated Slack webhook. In a real deployment this is a real URL and the
# monitor POSTs to it. Here we just print the payload we would have sent.
SLACK_WEBHOOK_URL = None  # e.g. "https://hooks.slack.com/services/XXX/YYY/ZZZ"

# Personal email domains cannot be used for account matching by domain.
PERSONAL_EMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
    "aol.com", "live.com", "me.com", "proton.me", "protonmail.com",
}

# Legal suffixes stripped during company-name normalization.
COMPANY_SUFFIXES = {
    "inc", "llc", "ltd", "corp", "co", "company", "group", "holdings",
    "llp", "pllc", "pc", "academy", "academies",  # academy kept-cautiously below
}

# Path for the SQLite database.
DB_PATH = "data/routing.db"
