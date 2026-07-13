"use client";

import { Fragment, useMemo, useState } from "react";
import {
  bandWord,
  Decision,
  fmtMinutes,
  methodLabel,
  nextStep,
  repName,
  ruleLabel,
  statusLabel,
  SIGNALS,
} from "@/lib/snapshot";

const PAGE = 40;

function ScoreBreakdown({ d }: { d: Decision }) {
  return (
    <div className="bd">
      {SIGNALS.map((s) => {
        const pts = d.score_breakdown?.[s.key] ?? 0;
        return (
          <div className="bd-row" key={s.key}>
            <span className="bd-label">{s.label}</span>
            <div className="track">
              <div className="fill" style={{ width: `${(pts / s.max) * 100}%` }} />
            </div>
            <span className="bd-pts">
              {pts} <em>/ {s.max}</em>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({ d }: { d: Decision }) {
  return (
    <tr className="detail-row">
      <td colSpan={9}>
        <div className="detail">
          <div className="detail-col">
            <h4>
              Why this score: {d.score} / 100 ({bandWord(d.band)})
            </h4>
            <ScoreBreakdown d={d} />
          </div>
          <div className="detail-col">
            <h4>About the lead</h4>
            <dl>
              <dt>Title</dt>
              <dd>{d.job_title}</dd>
              <dt>Industry</dt>
              <dd>{d.industry}</dd>
              <dt>Company size</dt>
              <dd>
                {d.employee_count != null
                  ? `${d.employee_count.toLocaleString()} employees`
                  : "—"}
              </dd>
              <dt>Came from</dt>
              <dd>{d.source.replace(/_/g, " ")}</dd>
              <dt>State</dt>
              <dd>{d.state || "—"}</dd>
              <dt>Email type</dt>
              <dd>{d.is_personal_email ? "personal (e.g. gmail)" : "company address"}</dd>
            </dl>
          </div>
          <div className="detail-col">
            <h4>What happened</h4>
            <dl>
              <dt>Company match</dt>
              <dd>
                {methodLabel(d.match_method)}
                {d.matched_account_id && d.match_confidence < 1 && (
                  <span className="dim"> ({Math.round(d.match_confidence * 100)}% sure)</span>
                )}
              </dd>
              <dt>Rule applied</dt>
              <dd>{ruleLabel(d.rule_fired)}</dd>
              <dt>Went to</dt>
              <dd>{repName(d.assigned_rep_id) ?? "no one yet"}</dd>
              <dt>Time to assign</dt>
              <dd>{fmtMinutes(d.time_in_queue_min)}</dd>
            </dl>
            <p className="detail-reason">{d.reason}</p>
            <p className="detail-action">
              <strong>Next step:</strong> {nextStep(d)}
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function AuditExplorer({
  decisions,
  status,
  onStatusChange,
}: {
  decisions: Decision[];
  status: string;
  onStatusChange: (s: string) => void;
}) {
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState("all");
  const [rule, setRule] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rules = useMemo(
    () => Array.from(new Set(decisions.map((d) => d.rule_fired))).sort(),
    [decisions]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return decisions.filter((d) => {
      if (status !== "all" && d.status !== status) return false;
      if (segment !== "all" && d.segment !== segment) return false;
      if (rule !== "all" && d.rule_fired !== rule) return false;
      if (needle) {
        const hay = `${d.lead_id} ${d.company} ${repName(d.assigned_rep_id) ?? ""} ${
          d.matched_account_id ?? ""
        } ${d.reason}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [decisions, q, status, segment, rule]);

  const shown = filtered.slice(0, limit);

  return (
    <div>
      <div className="controls">
        <input
          placeholder="Search by company, lead ID, rep name, or reason..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            onStatusChange(e.target.value);
            setLimit(PAGE);
          }}
        >
          <option value="all">All outcomes</option>
          <option value="routed">Routed to a rep</option>
          <option value="nurture">Nurture list</option>
          <option value="unrouted">Stuck (no rep)</option>
        </select>
        <select value={segment} onChange={(e) => { setSegment(e.target.value); setLimit(PAGE); }}>
          <option value="all">All segments</option>
          <option value="SMB">SMB</option>
          <option value="MidMarket">MidMarket</option>
          <option value="Enterprise">Enterprise</option>
        </select>
        <select value={rule} onChange={(e) => { setRule(e.target.value); setLimit(PAGE); }}>
          <option value="all">All rules</option>
          {rules.map((r) => (
            <option key={r} value={r}>
              {ruleLabel(r)}
            </option>
          ))}
        </select>
        <span className="count-note">
          {filtered.length.toLocaleString()} of {decisions.length.toLocaleString()} leads
        </span>
      </div>

      <div className="table-scroll">
        <table className="audit">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Company</th>
              <th>Segment / Region</th>
              <th>Score</th>
              <th>Match</th>
              <th>Rule applied</th>
              <th>Went to</th>
              <th>Outcome</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <Fragment key={d.lead_id}>
                <tr
                  className={`row-click ${expanded === d.lead_id ? "open" : ""}`}
                  onClick={() =>
                    setExpanded(expanded === d.lead_id ? null : d.lead_id)
                  }
                >
                  <td className="mono">{d.lead_id}</td>
                  <td>{d.company}</td>
                  <td>
                    {d.segment}
                    <span style={{ color: "var(--ink-3)" }}> / {d.region}</span>
                  </td>
                  <td>
                    <span className="score-tag">{d.score}</span>
                    <span className={`band ${d.band}`}>{bandWord(d.band)}</span>
                  </td>
                  <td>{methodLabel(d.match_method)}</td>
                  <td>{ruleLabel(d.rule_fired)}</td>
                  <td>{repName(d.assigned_rep_id) ?? "—"}</td>
                  <td>
                    <span className={`pill ${d.status}`}>{statusLabel(d.status)}</span>
                  </td>
                  <td className="reason">{d.reason}</td>
                </tr>
                {expanded === d.lead_id && <DetailRow d={d} />}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {limit < filtered.length && (
        <button className="more-btn" onClick={() => setLimit((l) => l + PAGE * 2)}>
          Show more ({(filtered.length - limit).toLocaleString()} remaining)
        </button>
      )}
    </div>
  );
}
