"""
Synthetic data generator, tuned to brightwheel's market (early education).

The point of a routing engine is how it handles messy reality, so the generator
deliberately injects the edge cases that break naive routers:

  - Company-name variants of existing accounts ("Sunshine Learning Center" vs
    "sunshine learning ctr llc") so the fuzzy matcher has something to earn.
  - Personal email domains (gmail, yahoo) on ~35% of leads, which defeat
    domain-based matching and force a fallback to name matching.
  - Missing fields (no company, no state, no phone) that must not crash routing.
  - International leads that should route to INTL, not a US queue.
  - A spread of intent signals (demo requests through cold lists) so scoring
    and band-based routing actually vary.

Everything is seeded, so the same run always produces the same data.
"""

import random
import string

import config
import db
from normalize import normalize_company, normalize_domain, email_domain, is_personal_email
from taxonomy import region_for_state, segment_for_locations

rng = random.Random(config.RANDOM_SEED)

# ---------------------------------------------------------------------------
# Word banks for believable early-education provider names.
# ---------------------------------------------------------------------------
NAME_PREFIX = ["Sunshine", "Little", "Bright", "Happy", "Rainbow", "Discovery",
               "Kids", "Tiny", "Wonder", "Maple", "Cedar", "Bright Star",
               "Growing", "First Steps", "Playful", "Acorn", "Bluebird",
               "Sunflower", "Meadow", "Riverside"]
NAME_CORE = ["Learning Center", "Academy", "Preschool", "Childcare", "Montessori",
             "Early Learning", "Day School", "Kids Club", "Learning Lab",
             "Child Development Center", "Nursery", "Care"]
NAME_SUFFIX = ["", "Inc", "LLC", "Co", "Group", "Academy"]

INDUSTRIES = ["Childcare", "Preschool", "Montessori", "Head Start",
              "After-School", "Faith-Based Childcare", "Franchise Childcare"]

JOB_TITLES = [
    ("Owner", "owner"),
    ("Founder", "owner"),
    ("Center Director", "director"),
    ("Executive Director", "director"),
    ("Program Director", "director"),
    ("Administrator", "manager"),
    ("Assistant Director", "manager"),
    ("Lead Teacher", "individual"),
    ("Office Manager", "manager"),
    ("Franchise Owner", "owner"),
]

STATES = list(sorted(set().union(*config.US_REGIONS.values())))
INTL_COUNTRIES = ["CA", "UK", "AU", "IE", "NZ"]

TIMEZONES = {
    "West": "America/Los_Angeles",
    "Central": "America/Chicago",
    "East": "America/New_York",
    "INTL": "UTC",
}

SOURCES_INBOUND = ["demo_request", "pricing_page", "contact_sales", "free_trial",
                   "webinar", "content_download", "newsletter"]
SOURCES_OUTBOUND = ["outbound_sequence", "cold_list"]

CAMPAIGNS = ["gg_search_brand", "gg_search_generic", "fb_retargeting",
             "childcare_webinar_q3", "state_licensing_guide", "referral_program",
             "conf_naeyc", "outbound_smb_push", None]


def _rand_name():
    prefix = rng.choice(NAME_PREFIX)
    core = rng.choice(NAME_CORE)
    suffix = rng.choice(NAME_SUFFIX)
    base = f"{prefix} {core}".strip()
    return f"{base} {suffix}".strip() if suffix else base


def _messy_variant(name):
    """Produce a human-typed variant of a known account name."""
    s = name
    choice = rng.random()
    if choice < 0.25:
        s = s.replace("Center", "Ctr").replace("Academy", "Acad")
    elif choice < 0.45:
        s = "The " + s
    elif choice < 0.65:
        s = s.lower()
    elif choice < 0.80:
        s = s.replace(" ", "")            # smushed together
    # Randomly append or drop a legal suffix.
    if rng.random() < 0.3 and not s.endswith(("Inc", "LLC", "Co")):
        s = s + ", " + rng.choice(["Inc.", "LLC", "Co."])
    return s


def _domain_from_name(name):
    slug = "".join(c for c in name.lower() if c in string.ascii_lowercase)
    slug = slug[:18] or "provider"
    return slug + rng.choice([".com", ".org", ".net", ".edu"])


def _phone():
    return f"({rng.randint(200,989)}) {rng.randint(200,989)}-{rng.randint(1000,9999)}"


# ---------------------------------------------------------------------------
# Accounts (the existing book of business)
# ---------------------------------------------------------------------------
def generate_accounts(conn):
    rep_ids = [r[0] for r in config.REPS]
    rows = []
    accounts = []
    for i in range(config.NUM_ACCOUNTS):
        acct_id = f"A{i:05d}"
        name = _rand_name()
        state = rng.choice(STATES)
        region = region_for_state(state)
        num_locations = rng.choices([1, 2, 4, 8, 20, 45], weights=[40, 25, 15, 10, 7, 3])[0]
        segment = segment_for_locations(num_locations)
        domain = _domain_from_name(name)
        is_customer = 1 if rng.random() < 0.45 else 0
        has_open_opp = 1 if (not is_customer and rng.random() < 0.30) else 0
        owned = is_customer or has_open_opp or rng.random() < 0.3
        owner = rng.choice(rep_ids) if owned else None
        last_activity = rng.choices(
            [rng.randint(0, 30), rng.randint(31, 89), rng.randint(90, 400)],
            weights=[50, 25, 25],
        )[0] if owned else None

        rows.append((
            acct_id, name, normalize_company(name), domain, region, state,
            segment, is_customer, has_open_opp, owner, last_activity,
        ))
        accounts.append({"name": name, "domain": domain, "state": state,
                         "segment": segment, "id": acct_id})

    conn.executemany(
        "INSERT INTO accounts VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows
    )
    conn.commit()
    return accounts


# ---------------------------------------------------------------------------
# Leads
# ---------------------------------------------------------------------------
def generate_leads(conn, accounts):
    rows = []
    for i in range(config.NUM_LEADS):
        lead_id = f"L{i:06d}"
        # ~40% of leads relate to a known account (expansion / repeat interest).
        from_known = rng.random() < 0.40 and accounts
        if from_known:
            acct = rng.choice(accounts)
            company = _messy_variant(acct["name"])
            state = acct["state"]
            # 60% of the time reuse the corporate domain, else personal email.
            use_corp = rng.random() < 0.55
        else:
            company = _rand_name()
            state = rng.choice(STATES)
            use_corp = rng.random() < 0.55

        # Country / region.
        if rng.random() < 0.06:
            country = rng.choice(INTL_COUNTRIES)
            state = ""
            region = "INTL"
        else:
            country = "US"
            region = region_for_state(state)

        first = rng.choice(["Sarah", "Michael", "Jessica", "David", "Emily",
                            "James", "Ashley", "Robert", "Maria", "Kevin",
                            "Linda", "Carlos", "Nicole", "Brandon", "Angela"])
        last = rng.choice(["Johnson", "Smith", "Williams", "Garcia", "Brown",
                          "Davis", "Martinez", "Nguyen", "Patel", "Lee",
                          "Wilson", "Thompson", "Rivera", "Clark", "Adams"])

        title, seniority = rng.choice(JOB_TITLES)

        # Firmographics.
        num_locations = rng.choices([1, 2, 3, 6, 12, 30], weights=[42, 24, 14, 10, 6, 4])[0]
        student_count = num_locations * rng.randint(15, 90)

        # Email: corporate (matchable by domain) or personal (not matchable).
        if use_corp and country == "US":
            corp_domain = _domain_from_name(company)
            email = f"{first.lower()}.{last.lower()}@{corp_domain}"
        else:
            corp_domain = ""
            personal = rng.choice(list(config.PERSONAL_EMAIL_DOMAINS))
            email = f"{first.lower()}{last.lower()}{rng.randint(1,99)}@{personal}"

        # Channel + source.
        if rng.random() < 0.70:
            channel = "inbound"
            source = rng.choices(
                SOURCES_INBOUND,
                weights=[18, 15, 12, 14, 12, 20, 9],
            )[0]
        else:
            channel = "outbound"
            source = rng.choice(SOURCES_OUTBOUND)

        # Behavioral signals.
        pages_viewed = rng.choices([0, 1, 3, 8, 20], weights=[30, 25, 25, 15, 5])[0]
        trial_started = 1 if source == "free_trial" or rng.random() < 0.08 else 0
        days_since_touch = rng.choices([0, 1, 5, 20, 60], weights=[35, 25, 20, 12, 8])[0]

        # ---- Inject missing / dirty fields ----
        if rng.random() < 0.05:
            company = ""                    # no company provided
        if rng.random() < 0.04:
            state = ""                      # missing state
            if country == "US":
                region = "INTL"             # cannot regionalize -> overflow path
        phone = _phone() if rng.random() > 0.10 else ""

        created_offset = rng.randint(0, 8 * 60)   # spread across an 8-hour day

        rows.append((
            lead_id, created_offset, first, last, email, email_domain(email),
            int(is_personal_email(email)), company, normalize_company(company),
            normalize_domain(corp_domain) if corp_domain else "",
            phone, country, state, region, TIMEZONES.get(region, "UTC"),
            num_locations, student_count, rng.choice(INDUSTRIES), title, seniority,
            source, channel, rng.choice(CAMPAIGNS),
            pages_viewed, trial_started, days_since_touch,
        ))

    conn.executemany(
        "INSERT INTO leads VALUES (" + ",".join(["?"] * len(rows[0])) + ")", rows
    )
    conn.commit()


def build():
    conn = db.connect()
    db.init_db(conn)
    db.load_reps(conn)
    accounts = generate_accounts(conn)
    generate_leads(conn, accounts)
    n_leads = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
    n_acct = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    conn.close()
    print(f"Generated {n_leads} leads and {n_acct} accounts.")


if __name__ == "__main__":
    build()
