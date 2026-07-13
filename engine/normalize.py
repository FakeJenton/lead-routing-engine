"""
Normalization helpers shared by the generator and the matcher.

Matching is the hardest part of routing, and almost all of the difficulty is
here: "Bright Wheel Inc.", "brightwheel", and "The Bright Wheel Academy, LLC"
are the same account, and a router that cannot see that will create duplicate
accounts and misroute expansion leads to the wrong rep. These functions are the
cleanup layer that makes fuzzy matching possible.
"""

import re

import config


def normalize_company(name):
    """Lowercase, strip punctuation and legal suffixes, collapse whitespace."""
    if not name:
        return ""
    s = name.lower()
    s = re.sub(r"[^\w\s]", " ", s)        # drop punctuation
    s = re.sub(r"\s+", " ", s).strip()
    tokens = [t for t in s.split(" ") if t and t not in config.COMPANY_SUFFIXES]
    # Drop a leading "the".
    if tokens and tokens[0] == "the":
        tokens = tokens[1:]
    return " ".join(tokens)


def normalize_domain(value):
    """Reduce an email or URL to a bare registrable-ish domain."""
    if not value:
        return ""
    s = value.strip().lower()
    if "@" in s:                          # it's an email
        s = s.split("@", 1)[1]
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = s.split("/", 1)[0]
    return s


def email_domain(email):
    if not email or "@" not in email:
        return ""
    return email.split("@", 1)[1].strip().lower()


def is_personal_email(email):
    return email_domain(email) in config.PERSONAL_EMAIL_DOMAINS
