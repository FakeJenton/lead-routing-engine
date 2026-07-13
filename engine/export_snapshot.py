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
                  l.job_title, l.industry, l.employee_count, l.is_personal_email
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
    reps = []
    for r in conn.execute("SELECT * FROM reps"):
        reps.append({
            "rep_id": r["rep_id"], "name": r["name"], "segment": r["segment"],
            "region": r["region"], "seniority": r["seniority"],
            "is_ramping": bool(r["is_ramping"]), "capacity": r["capacity"],
            "load": per_rep.get(r["rep_id"], 0),
        })

    # Alerts, mirroring monitor.run's guardrail checks.
    alerts = []
    match_rate = len(matched) / total if total else 0
    override_rate = len(overrides) / len(routed) if routed else 0
    for seg, reg, rid, c, fair in skew_flags:
        alerts.append({"level": "warning",
                       "text": f"Distribution skew in {seg}/{reg}: {rid} took {c} leads "
                               f"vs fair share ~{fair}. Review round-robin weights."})
    if unrouted:
        alerts.append({"level": "critical",
                       "text": f"{len(unrouted)} leads UNROUTED (no capacity). Escalate to "
                               f"routing owner within "
                               f"{config.GUARDRAILS['unrouted_escalation_minutes']}m."})
    if override_rate > config.GUARDRAILS["override_rate_alert"]:
        alerts.append({"level": "warning",
                       "text": f"Manual override rate {override_rate:.0%} exceeds threshold."})
    if match_rate < config.GUARDRAILS["min_match_rate_alert"]:
        alerts.append({"level": "warning",
                       "text": f"Match rate {match_rate:.0%} below threshold."})

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
