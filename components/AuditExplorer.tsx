"use client";

import { Fragment, useMemo, useState } from "react";
import { Decision, methodLabel, ruleLabel, SIGNALS } from "@/lib/snapshot";

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
            <h4>Score breakdown · {d.score} pts (band {d.band})</h4>
            <ScoreBreakdown d={d} />
          </div>
          <div className="detail-col">
            <h4>Lead</h4>
            <dl>
              <dt>Title</dt>
              <dd>
                {d.job_title} <span className="dim">({d.seniority})</span>
              </dd>
              <dt>Industry</dt>
              <dd>{d.industry}</dd>
              <dt>Employees</dt>
              <dd>{d.employee_count?.toLocaleString() ?? "—"}</dd>
              <dt>Source</dt>
              <dd>{d.source}</dd>
              <dt>State</dt>
              <dd>{d.state || "—"}</dd>
              <dt>Email</dt>
              <dd>{d.is_personal_email ? "personal domain" : "corporate domain"}</dd>
            </dl>
          </div>
          <div className="detail-col">
            <h4>Routing decision</h4>
            <dl>
              <dt>Match</dt>
              <dd>
                {methodLabel(d.match_method)}
                {d.matched_account_id && (
                  <>
                    {" "}
                    → <span className="mono">{d.matched_account_id}</span>
                    <span className="dim"> (conf {d.match_confidence})</span>
                  </>
                )}
              </dd>
              <dt>Rule fired</dt>
              <dd>{ruleLabel(d.rule_fired)}</dd>
              <dt>Assigned</dt>
              <dd className="mono">{d.assigned_rep_id ?? "—"}</dd>
              <dt>Queue time</dt>
              <dd>{d.time_in_queue_min != null ? `${d.time_in_queue_min}m` : "—"}</dd>
            </dl>
            <p className="detail-reason">{d.reason}</p>
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
        const hay = `${d.lead_id} ${d.company} ${d.assigned_rep_id ?? ""} ${
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
          placeholder="Search company, lead ID, rep, reason..."
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
          <option value="all">All statuses</option>
          <option value="routed">Routed</option>
          <option value="nurture">Nurture</option>
          <option value="unrouted">Unrouted</option>
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
              <th>Seg / Region</th>
              <th>Score</th>
              <th>Match</th>
              <th>Rule fired</th>
              <th>Rep</th>
              <th>Status</th>
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
                    <span className={`band ${d.band}`}>{d.band}</span>
                  </td>
                  <td>
                    <span className="mono">{d.match_method}</span>
                  </td>
                  <td>{ruleLabel(d.rule_fired)}</td>
                  <td className="mono">{d.assigned_rep_id ?? "—"}</td>
                  <td>
                    <span className={`pill ${d.status}`}>{d.status}</span>
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
