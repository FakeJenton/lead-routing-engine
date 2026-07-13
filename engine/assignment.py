"""
Queue assignment: weighted, capacity-aware round-robin.

Once the router has decided a lead should go to a (segment, region) queue rather
than to a specific owner, this module picks the rep. Real-world messiness that a
naive round-robin ignores:

  - Capacity caps: a rep at their active-lead ceiling is skipped, not piled on.
  - Ramping weight: new hires carry a fractional weight so they receive
    proportionally fewer leads while they get up to speed.
  - Senior preference: A-band (high-score) leads prefer a senior rep in the
    queue, because speed-to-lead on your best leads is where money is won.
  - Region overflow: if the exact queue is exhausted, fall back to the same
    segment in another region rather than dropping a live lead on the floor.

"Weighted least-loaded" (assign to whoever has the lowest load-to-weight ratio)
is used instead of a rotating pointer. It self-corrects: skipped or capped reps
naturally catch up, and the distribution stays fair without a stored cursor.
"""

import config


class RepPool:
    def __init__(self, conn):
        self.reps = {r["rep_id"]: dict(r) for r in conn.execute("SELECT * FROM reps")}
        self.load = {rid: 0 for rid in self.reps}
        self.weight = {
            rid: (config.RAMPING_WEIGHT if r["is_ramping"] else config.FULL_WEIGHT)
            for rid, r in self.reps.items()
        }

    def _eligible(self, segment, region, senior_only=False):
        out = []
        for rid, r in self.reps.items():
            if r["segment"] != segment:
                continue
            if region is not None and r["region"] != region:
                continue
            if senior_only and r["seniority"] != "senior":
                continue
            if self.load[rid] >= r["capacity"]:
                continue
            out.append(rid)
        return out

    def _pick(self, candidates):
        # Lowest load-to-weight ratio wins; tie-break on rep_id for determinism.
        return min(candidates, key=lambda rid: (self.load[rid] / self.weight[rid], rid))

    def assign(self, segment, region, prefer_senior=False):
        """Return (rep_id, reason) or (None, reason) if nothing is available."""
        # 1. A-band: try senior reps in the exact queue first.
        if prefer_senior:
            seniors = self._eligible(segment, region, senior_only=True)
            if seniors:
                rid = self._pick(seniors)
                self.load[rid] += 1
                return rid, "senior_preferred_in_queue"

        # 2. Standard: any available rep in the exact (segment, region) queue.
        exact = self._eligible(segment, region)
        if exact:
            rid = self._pick(exact)
            self.load[rid] += 1
            return rid, "round_robin_in_queue"

        # 3. Overflow: same segment, any region.
        if config.ALLOW_REGION_OVERFLOW:
            overflow = self._eligible(segment, region=None)
            if overflow:
                rid = self._pick(overflow)
                self.load[rid] += 1
                return rid, "region_overflow"

        # 4. Nothing available (all capped). Caller marks the lead unrouted.
        return None, "no_capacity"
