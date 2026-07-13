"""
Lead-to-account matching.

This is the primitive LeanData is famous for, and the hardest part of routing.
The goal: given an inbound lead, decide whether it belongs to an account we
already know. Get it wrong and you create duplicate accounts, misroute
expansion leads away from the owning rep, and corrupt every downstream metric.

Strategy, in order of confidence:

  1. Exact corporate-domain match. Highest confidence. Skipped entirely for
     personal email domains (gmail etc.), because a gmail address tells you
     nothing about which account the person belongs to.
  2. Exact normalized-name match. "Bright Wheel Inc." and "brightwheel" both
     normalize to "bright wheel".
  3. Fuzzy normalized-name match, gated by geography. We only accept a fuzzy
     name match when the state agrees, because "Sunshine Preschool" exists in
     every state and name similarity alone would create false positives.

Returns (account_row_or_None, method, confidence).
"""

import difflib

from normalize import normalize_company

FUZZY_THRESHOLD = 0.88


def _index_accounts(accounts):
    by_domain = {}
    by_name = {}
    for a in accounts:
        if a["domain"]:
            by_domain[a["domain"].lower()] = a
        if a["name_normalized"]:
            by_name.setdefault(a["name_normalized"], a)
    return by_domain, by_name


def match_lead(lead, accounts_index):
    by_domain, by_name = accounts_index

    # 1. Domain match (only meaningful for corporate email / known domain).
    lead_domain = (lead["domain"] or "").lower()
    if lead_domain and not lead["is_personal_email"]:
        hit = by_domain.get(lead_domain)
        if hit:
            return hit, "domain", 1.0

    # 2. Exact normalized-name match.
    norm = lead["company_normalized"] or normalize_company(lead["company_name"] or "")
    if norm:
        hit = by_name.get(norm)
        if hit:
            return hit, "name_exact", 0.95

        # 3. Fuzzy name match, gated by state to suppress false positives.
        best, best_ratio = None, 0.0
        for cand_norm, acct in by_name.items():
            ratio = difflib.SequenceMatcher(None, norm, cand_norm).ratio()
            if ratio > best_ratio:
                best, best_ratio = acct, ratio
        if best and best_ratio >= FUZZY_THRESHOLD:
            same_state = lead["state"] and best["state"] and lead["state"] == best["state"]
            # Require geography agreement unless the name is a near-perfect hit.
            if same_state or best_ratio >= 0.96:
                return best, "name_fuzzy", round(best_ratio, 3)

    return None, "none", 0.0


def load_account_index(conn):
    accounts = conn.execute("SELECT * FROM accounts").fetchall()
    return _index_accounts(accounts)
