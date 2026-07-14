"""
Export the routing run to a JSON snapshot the web dashboard reads.

This is the seam between the engine and the presentation layer. The engine does
the work in Python/SQL; this writes a single static file the Next.js app renders
client-side, so the dashboard deploys to Vercel with no backend and cannot break
in front of an interviewer.

Run:  py export_snapshot.py
Writes: ../public/data/routing_snapshot.json
"""

import json
import os
from datetime import datetime, timezone

import config
import db
import generate_leads
import monitor
from main import route_all

OUT_PATH = os.path.join("..", "public", "data", "routing_snapshot.json")


def _counts(rows, key):
    out = {}
    for r in rows:
        out[r[key]] = out.get(r[key], 0) + 1
    return out


def build_snapshot(conn):
    decisions = [dict(r) for r in conn.execute(
        """SELECT d.*, l.company_name, l.state, l.lead_source, l.seniority,
                  l.job_title, l.industry, l.employee_count, l.is_personal_email,
                  l.pages_viewed, l.trial_started, l.days_since_touch
           FROM routing_decisions d JOIN leads l ON l.lead_id = d.lead_id"""
    ).fetchall()]

    total = len(decisions)
    routed = [d for d in decisions if d["status"] == "routed"]
    nurture = [d for d in decisions if d["status"] == "nurture"]
    unrouted = [d for d in decisions if d["status"] == "unrouted"]
    matched = [d for d in decisions if d["matched_account_id"]]

    sla = config.GUARDRAILS["sla_minutes"]
    sla_breaches = [d for d in routed if (d["time_in_queue_min"] or 0) > sla]
    overrides = [d for d in routed if d["manual_override"]]

    qt = sorted(d["time_in_queue_min"] for d in routed if d["time_in_queue_min"] is not None)

    def pct(p):
        if not qt:
            return 0.0
        return round(qt[min(len(qt) - 1, int(p / 100 * len(qt)))], 1)

    per_rep, skew_flags = monitor.distribution_report(decisions)

    # Pool-only load per rep: what actually counts against round-robin capacity.
    # Total load additionally includes owner-continuity routes, which do not.
    pool_load = {}
    for d in decisions:
        if (d["rule_fired"] or "").startswith("pool_") and d["assigned_rep_id"]:
            pool_load[d["assigned_rep_id"]] = pool_load.get(d["assigned_rep_id"], 0) + 1

    reps = []
    for r in conn.execute("SELECT * FROM reps"):
        reps.append({
            "rep_id": r["rep_id"], "name": r["name"], "segment": r["segment"],
            "region": r["region"], "seniority": r["seniority"],
            "is_ramping": bool(r["is_ramping"]), "capacity": r["capacity"],
            "load": per_rep.get(r["rep_id"], 0),
            "pool_load": pool_load.get(r["rep_id"], 0),
        })

    # Alerts, mirroring monitor.run's guardrail checks. Each alert is written in
    # plain English, carries a recommended action, and includes a `filter` spec
    # so the dashboard can jump straight to the exact leads being described.
    name_of = {r["rep_id"]: r["name"] for r in reps}
    pool_rules = ["pool_round_robin_in_queue", "pool_senior_preferred_in_queue"]
    alerts = []
    match_rate = len(matched) / total if total else 0
    override_rate = len(overrides) / len(routed) if routed else 0
    slow_rate = len(sla_breaches) / len(routed) if routed else 0
    n_overflow = sum(1 for d in decisions if d["rule_fired"] == "pool_region_overflow")
    hot_missed = [d for d in decisions
                  if d["score_band"] == "A" and d["rule_fired"] == "pool_round_robin_in_queue"]

    if unrouted:
        alerts.append({
            "level": "critical",
            "text": f"{len(unrouted)} leads are stuck with no rep, because every eligible "
                    f"rep is at their lead limit.",
            "action": "Assign these leads by hand today, and consider raising the "
                      "Enterprise team's lead limits or adding a rep.",
            "chip": "stuck with no rep",
            "filter": {"statuses": ["unrouted"]},
        })
    for seg, reg, rid, c, fair in skew_flags:
        alerts.append({
            "level": "warning",
            "text": f"On the {seg} {reg} team, {name_of.get(rid, rid)} received {c} leads, "
                    f"well above the fair share of about {round(fair)}.",
            "action": "Check this rep's round-robin weight and whether teammates were "
                      "marked unavailable or at their limit.",
            "chip": f"shared-pool leads to {name_of.get(rid, rid)}",
            "filter": {"rules": pool_rules, "q": name_of.get(rid, rid)},
        })
    if slow_rate > 0.05:
        alerts.append({
            "level": "warning",
            "text": f"{len(sla_breaches)} leads waited longer than the {sla}-minute goal "
                    f"before a rep was assigned ({slow_rate:.0%} of routed leads).",
            "action": "Look for time-of-day gaps and teams running at their limit. Speed "
                      "on the first touch is the cheapest win in the funnel.",
            "chip": f"waited over {sla} min",
            "filter": {"statuses": ["routed"], "min_wait_min": sla},
        })
    if override_rate > config.GUARDRAILS["override_rate_alert"]:
        alerts.append({
            "level": "warning",
            "text": f"Managers manually re-assigned {override_rate:.0%} of routed leads, "
                    f"more than expected.",
            "action": "Find the most-overridden rule and update it. Frequent overrides "
                      "mean the rules no longer match how the team actually works.",
            "chip": "manually re-assigned",
            "filter": {"overridden": True},
        })
    if match_rate < config.GUARDRAILS["min_match_rate_alert"]:
        alerts.append({
            "level": "warning",
            "text": f"Only {match_rate:.0%} of leads were recognized as companies we "
                    f"already know.",
            "action": "Review the company-name cleanup rules. A low match rate usually "
                      "means duplicates are being created.",
            "chip": "not matched to a known company",
            "filter": {"match": "none"},
        })
    if hot_missed:
        alerts.append({
            "level": "info",
            "text": f"{len(hot_missed)} hot leads went into the normal rotation because "
                    f"no senior rep had room.",
            "action": "Consider keeping some senior-rep headroom for hot leads, or "
                      "promoting a strong mid-level rep into the fast lane.",
            "chip": "hot leads without a senior rep",
            "filter": {"band": "A", "rules": ["pool_round_robin_in_queue"]},
        })
    if n_overflow and n_overflow / max(len(routed), 1) > 0.02:
        alerts.append({
            "level": "info",
            "text": f"{n_overflow} leads were sent to another region's team because their "
                    f"home team was full.",
            "action": "Occasional overflow is healthy. A steady stream from one region "
                      "means that team is under-staffed.",
            "chip": "sent out of region",
            "filter": {"rules": ["pool_region_overflow"]},
        })

    n_accounts = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]

    snapshot = {
        "summary": {
            "total": total,
            "routed": len(routed),
            "nurture": len(nurture),
            "unrouted": len(unrouted),
            "matched": len(matched),
            "match_rate": round(match_rate, 4),
            "override_rate": round(override_rate, 4),
            "sla_minutes": sla,
            "sla_breaches": len(sla_breaches),
            "speed_p50": pct(50), "speed_p90": pct(90), "speed_p99": pct(99),
            "num_reps": len(reps),
            "num_accounts": n_accounts,
            "resting_period_days": config.RESTING_PERIOD_DAYS,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "match_methods": [{"method": k, "count": v}
                          for k, v in sorted(_counts(decisions, "match_method").items())],
        "rules": sorted(
            [{"rule": k, "count": v} for k, v in _counts(decisions, "rule_fired").items()],
            key=lambda x: -x["count"]),
        "score_bands": sorted(
            [{"band": k, "count": v} for k, v in _counts(decisions, "score_band").items()],
            key=lambda x: x["band"]),
        "reps": reps,
        "alerts": alerts,
        "decisions": [{
            "lead_id": d["lead_id"],
            "company": d["company_name"] or "(no company)",
            "segment": d["segment"], "region": d["region"],
            "score": d["score"], "band": d["score_band"],
            "score_breakdown": json.loads(d["score_breakdown"] or "{}"),
            "match_method": d["match_method"],
            "match_confidence": d["match_confidence"],
            "matched_account_id": d["matched_account_id"],
            "rule_fired": d["rule_fired"],
            "assigned_rep_id": d["assigned_rep_id"],
            "status": d["status"],
            "reason": d["reason"],
            "time_in_queue_min": d["time_in_queue_min"],
            "source": d["lead_source"],
            "seniority": d["seniority"],
            "job_title": d["job_title"],
            "industry": d["industry"],
            "employee_count": d["employee_count"],
            "state": d["state"],
            "is_personal_email": bool(d["is_personal_email"]),
            "pages_viewed": d["pages_viewed"],
            "trial_started": bool(d["trial_started"]),
            "days_since_touch": d["days_since_touch"],
            "manual_override": bool(d["manual_override"]),
        } for d in decisions],
    }
    return snapshot


def main():
    generate_leads.build()
    conn = db.connect()
    route_all(conn)
    snapshot = build_snapshot(conn)
    conn.close()

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2)
    kb = os.path.getsize(OUT_PATH) / 1024
    print(f"Wrote {OUT_PATH} ({kb:.0f} KB, {len(snapshot['decisions'])} decisions).")


if __name__ == "__main__":
    main()
