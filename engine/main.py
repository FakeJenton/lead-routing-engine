"""
End-to-end pipeline: generate -> score -> match -> route -> monitor.

Run it:  py main.py            (regenerate data + route + report)
         py main.py --no-gen   (reuse existing data, just re-route + report)

This single command is the "workflow that runs without you touching it": a
scheduled job can call it nightly to generate the day's leads, route them,
write the audit log, and post the digest to Slack. No manual step in the loop.
"""

import random
import sys

import config
import db
import generate_leads
import matching
import monitor
from assignment import RepPool
from routing import route_lead

sim = random.Random(config.RANDOM_SEED + 1)


def _simulate_queue_time(status, rule_fired):
    """Stand-in for real speed-to-lead timestamps until wired to live events."""
    if status == "nurture":
        return None
    if status == "unrouted":
        return round(sim.uniform(15, 60), 1)          # sitting past escalation SLA
    if rule_fired and rule_fired.endswith("region_overflow"):
        return round(sim.uniform(3, 10), 1)           # overflow costs time
    if rule_fired and rule_fired.startswith("pool_"):
        return round(sim.uniform(0.5, 6), 1)
    return round(sim.uniform(0.3, 3), 1)              # owner-based, fastest


def route_all(conn):
    account_index = matching.load_account_index(conn)
    pool = RepPool(conn)

    # Process in arrival order so round-robin reflects real sequencing.
    leads = conn.execute(
        "SELECT * FROM leads ORDER BY created_offset_min, lead_id"
    ).fetchall()

    rows = []
    for lead in leads:
        d = route_lead(lead, account_index, pool)
        d["time_in_queue_min"] = _simulate_queue_time(d["status"], d["rule_fired"])
        # Simulate that a small share of routed leads get manually re-routed by
        # an operator. A rising override rate is a signal the rules are wrong.
        if d["status"] == "routed" and sim.random() < 0.07:
            d["manual_override"] = 1
        rows.append(d)

    conn.executemany(
        """INSERT OR REPLACE INTO routing_decisions
           (lead_id, matched_account_id, match_method, match_confidence, score,
            score_band, score_breakdown, segment, region, rule_fired,
            assigned_rep_id, status, reason, time_in_queue_min, manual_override)
           VALUES (:lead_id,:matched_account_id,:match_method,:match_confidence,
            :score,:score_band,:score_breakdown,:segment,:region,:rule_fired,
            :assigned_rep_id,:status,:reason,:time_in_queue_min,:manual_override)""",
        rows,
    )
    conn.commit()
    return len(rows)


def main():
    regenerate = "--no-gen" not in sys.argv
    if regenerate:
        generate_leads.build()

    conn = db.connect()
    n = route_all(conn)
    print(f"\nRouted {n} leads. Audit log written to routing_decisions.\n")
    monitor.run(conn)

    # Show a few sample audit entries so the "why" is visible.
    print("\nSAMPLE AUDIT TRAIL (first 6 decisions):")
    samples = conn.execute(
        "SELECT lead_id, rule_fired, assigned_rep_id, status, reason "
        "FROM routing_decisions LIMIT 6"
    ).fetchall()
    for s in samples:
        rep = s["assigned_rep_id"] or "-"
        print(f"  {s['lead_id']} [{s['status']}] rep={rep} rule={s['rule_fired']}")
        print(f"      {s['reason']}")
    conn.close()


if __name__ == "__main__":
    main()
