"""
Guardrails, monitoring, and the daily digest.

A routing owner does not configure routing and walk away. They watch it. This
module is the "guardrails, alerting, and monitoring" the JD asks for, plus the
"distribution checks" and "connect rate diagnostics" from the automation bullet.

It reads the audit log and computes the health metrics that matter:

  - Distribution fairness    : is any rep getting an unfair share of their queue?
  - Speed-to-lead SLA        : what fraction of assignments breached the SLA?
  - Match rate               : are we matching leads to accounts, or leaking net-new?
  - Unrouted / escalations   : did any live lead fall on the floor?
  - Override rate            : proxy for "the rules are wrong."

Anything that breaches a guardrail threshold emits an alert. In production the
alert POSTs to a Slack webhook; here it prints the exact payload it would send.
"""

import json
import statistics
import urllib.request

import config


def _fetch(conn):
    rows = conn.execute("SELECT * FROM routing_decisions").fetchall()
    return [dict(r) for r in rows]


def _send_alert(text):
    payload = {"text": text}
    if config.SLACK_WEBHOOK_URL:
        try:
            req = urllib.request.Request(
                config.SLACK_WEBHOOK_URL,
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception as e:  # noqa: BLE001 - alerting must never crash routing
            print(f"  [alert delivery failed: {e}]")
    print(f"  ALERT -> Slack payload: {json.dumps(payload)}")


def distribution_report(decisions):
    """Per-rep load (all routed) plus skew flags on round-robin assignments only."""
    routed = [d for d in decisions if d["status"] == "routed" and d["assigned_rep_id"]]
    per_rep = {}
    for d in routed:
        per_rep.setdefault(d["assigned_rep_id"], 0)
        per_rep[d["assigned_rep_id"]] += 1

    # Skew is only meaningful for the mechanism we control: native round-robin
    # inside a queue. Owner-based routes cannot be rebalanced, and overflow
    # routes land a rep in a queue that is not their own, so both are excluded
    # to keep the fair-share math per queue clean.
    native_rules = {"pool_round_robin_in_queue", "pool_senior_preferred_in_queue"}
    pool_routed = [d for d in routed if d["rule_fired"] in native_rules]

    # Fair share is computed per (segment, region) queue so cross-queue volume
    # differences do not create false skew alerts.
    queues = {}
    for d in pool_routed:
        key = (d["segment"], d["region"])
        queues.setdefault(key, {}).setdefault(d["assigned_rep_id"], 0)
        queues[key][d["assigned_rep_id"]] += 1

    flags = []
    floor = config.GUARDRAILS["skew_min_queue_volume"]
    for (seg, reg), counts in queues.items():
        n_reps = len(counts)
        total = sum(counts.values())
        if n_reps <= 1 or total < floor:      # skip single-rep and thin queues
            continue
        fair = total / n_reps
        threshold = fair * config.GUARDRAILS["skew_fair_share_multiple"]
        for rid, c in counts.items():
            if c > threshold:
                flags.append((seg, reg, rid, c, round(fair, 1)))
    return per_rep, flags


def run(conn):
    decisions = _fetch(conn)
    total = len(decisions)
    routed = [d for d in decisions if d["status"] == "routed"]
    nurture = [d for d in decisions if d["status"] == "nurture"]
    unrouted = [d for d in decisions if d["status"] == "unrouted"]
    matched = [d for d in decisions if d["matched_account_id"]]

    match_rate = len(matched) / total if total else 0
    sla = config.GUARDRAILS["sla_minutes"]
    sla_breaches = [d for d in routed if (d["time_in_queue_min"] or 0) > sla]
    overrides = [d for d in routed if d["manual_override"]]
    override_rate = len(overrides) / len(routed) if routed else 0

    queue_times = [d["time_in_queue_min"] for d in routed if d["time_in_queue_min"] is not None]
    queue_times.sort()

    def pct(p):
        if not queue_times:
            return 0.0
        idx = min(len(queue_times) - 1, int(p / 100 * len(queue_times)))
        return round(queue_times[idx], 1)

    per_rep, skew_flags = distribution_report(decisions)

    # --- Digest ---
    lines = []
    lines.append("=" * 68)
    lines.append("DAILY ROUTING DIGEST")
    lines.append("=" * 68)
    lines.append(f"Leads processed        : {total}")
    lines.append(f"  routed               : {len(routed)} ({len(routed)/total:.0%})")
    lines.append(f"  nurture (low score)  : {len(nurture)} ({len(nurture)/total:.0%})")
    lines.append(f"  unrouted (escalated) : {len(unrouted)} ({len(unrouted)/total:.0%})")
    lines.append("")
    lines.append(f"Account match rate     : {match_rate:.0%}  "
                 f"({len(matched)}/{total} matched to a known account)")
    by_method = {}
    for d in decisions:
        by_method[d["match_method"]] = by_method.get(d["match_method"], 0) + 1
    lines.append(f"  by method            : " +
                 ", ".join(f"{k}={v}" for k, v in sorted(by_method.items())))
    lines.append("")
    lines.append(f"Speed-to-lead (routed) : p50={pct(50)}m  p90={pct(90)}m  p99={pct(99)}m")
    lines.append(f"  SLA ({sla}m) breaches   : {len(sla_breaches)} "
                 f"({len(sla_breaches)/len(routed):.0%} of routed)" if routed else "  SLA: n/a")
    lines.append(f"Manual override rate   : {override_rate:.0%} "
                 f"({len(overrides)}/{len(routed)})")
    lines.append("")
    lines.append("Rule firing counts:")
    by_rule = {}
    for d in decisions:
        by_rule[d["rule_fired"]] = by_rule.get(d["rule_fired"], 0) + 1
    for rule, c in sorted(by_rule.items(), key=lambda x: -x[1]):
        lines.append(f"  {rule:<32} {c}")
    lines.append("")
    lines.append("Load per rep:")
    for rid in sorted(per_rep):
        lines.append(f"  {rid}  {per_rep[rid]:>4} leads")
    lines.append("=" * 68)
    digest = "\n".join(lines)
    print(digest)

    # --- Guardrail checks / alerts ---
    print("\nGUARDRAIL CHECKS")
    breached = False
    if skew_flags:
        breached = True
        for seg, reg, rid, c, fair in skew_flags:
            _send_alert(f":warning: Distribution skew in {seg}/{reg}: {rid} took {c} "
                        f"leads vs fair share ~{fair}. Review round-robin weights.")
    if unrouted:
        breached = True
        _send_alert(f":rotating_light: {len(unrouted)} leads UNROUTED (no capacity). "
                    f"Escalate to routing owner within "
                    f"{config.GUARDRAILS['unrouted_escalation_minutes']}m.")
    if override_rate > config.GUARDRAILS["override_rate_alert"]:
        breached = True
        _send_alert(f":warning: Manual override rate {override_rate:.0%} exceeds "
                    f"{config.GUARDRAILS['override_rate_alert']:.0%}. Routing rules may be wrong.")
    if match_rate < config.GUARDRAILS["min_match_rate_alert"]:
        breached = True
        _send_alert(f":warning: Match rate {match_rate:.0%} below "
                    f"{config.GUARDRAILS['min_match_rate_alert']:.0%}. Matching may be failing.")
    if len(sla_breaches) / len(routed) > 0.20 if routed else False:
        breached = True
        _send_alert(f":warning: {len(sla_breaches)} assignments breached the {sla}m "
                    f"speed-to-lead SLA.")
    if not breached:
        print("  All guardrails within thresholds. No alerts.")

    # Persist the digest for the record.
    with open("data/daily_digest.txt", "w", encoding="utf-8") as f:
        f.write(digest)
    return digest
