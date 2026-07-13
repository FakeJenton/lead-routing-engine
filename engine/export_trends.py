"""
Export 12 simulated weekly runs to a trends file the dashboard charts.

Each "week" re-runs the full pipeline with a different seed, producing natural
variation in match rate, assignment speed, stuck leads, and override rate. In a
real deployment this file would instead be appended by the nightly job, one row
per run, and the dashboard would show genuine history.

Run:  py export_trends.py
Writes: ../public/data/trends.json
"""

import json
import os
import random
from datetime import datetime, timedelta, timezone

import config
import db
import generate_leads
import main as engine_main
from main import route_all

OUT_PATH = os.path.join("..", "public", "data", "trends.json")
NUM_WEEKS = 12


def run_once(seed):
    """Re-seed the generators, run the pipeline, return summary metrics."""
    generate_leads.rng = random.Random(seed)
    engine_main.sim = random.Random(seed + 1)

    conn = db.connect()
    db.init_db(conn)
    db.load_reps(conn)
    accounts = generate_leads.generate_accounts(conn)
    generate_leads.generate_leads(conn, accounts)
    route_all(conn)

    rows = [dict(r) for r in conn.execute("SELECT * FROM routing_decisions")]
    conn.close()

    total = len(rows)
    routed = [d for d in rows if d["status"] == "routed"]
    unrouted = [d for d in rows if d["status"] == "unrouted"]
    matched = [d for d in rows if d["matched_account_id"]]
    overrides = [d for d in routed if d["manual_override"]]
    sla = config.GUARDRAILS["sla_minutes"]
    slow = [d for d in routed if (d["time_in_queue_min"] or 0) > sla]

    qt = sorted(d["time_in_queue_min"] for d in routed if d["time_in_queue_min"] is not None)
    p50 = round(qt[len(qt) // 2], 2) if qt else 0.0

    return {
        "routed_pct": round(len(routed) / total, 4),
        "match_rate": round(len(matched) / total, 4),
        "assign_p50_min": p50,
        "stuck": len(unrouted),
        "override_pct": round(len(overrides) / len(routed), 4) if routed else 0,
        "slow_pct": round(len(slow) / len(routed), 4) if routed else 0,
    }


def main():
    today = datetime.now(timezone.utc).date()
    weeks = []
    for i in range(NUM_WEEKS):
        seed = config.RANDOM_SEED + i * 101
        metrics = run_once(seed)
        week_start = today - timedelta(weeks=NUM_WEEKS - 1 - i)
        metrics["week"] = week_start.strftime("%b %d")
        weeks.append(metrics)
        print(f"week {i + 1}/{NUM_WEEKS} ({metrics['week']}): "
              f"match {metrics['match_rate']:.0%}, stuck {metrics['stuck']}")

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sla_minutes": config.GUARDRAILS["sla_minutes"],
        "weeks": weeks,
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"Wrote {OUT_PATH} ({len(weeks)} weeks).")

    # Leave the main snapshot's data (default seed) back in place so the
    # dashboard and trends stay consistent.
    generate_leads.rng = random.Random(config.RANDOM_SEED)
    engine_main.sim = random.Random(config.RANDOM_SEED + 1)


if __name__ == "__main__":
    main()
