"""
Small pure functions that turn raw firmographics into routing dimensions.

These are shared by the generator (to stamp accounts) and the router (to place
leads), so the segment/region logic lives in exactly one place.
"""

import config


def region_for_state(state, country="US"):
    if country != "US":
        return "INTL"
    for region, states in config.US_REGIONS.items():
        if state in states:
            return region
    return "INTL"


def segment_for_size(employee_count):
    for name, lo, hi in config.SEGMENT_RULES:
        if lo <= employee_count <= hi:
            return name
    return "SMB"
