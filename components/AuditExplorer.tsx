"use client";

import { useMemo, useState } from "react";
import { Decision, ruleLabel } from "@/lib/snapshot";

const PAGE = 40;

export default function AuditExplorer({ decisions }: { decisions: Decision[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [segment, setSegment] = useState("all");
  const [rule, setRule] = useState("all");
  const [limit, setLimit] = useState(PAGE);

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
        <select value={status} onChange={(e) => { setStatus(e.target.value); setLimit(PAGE); }}>
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
              <tr key={d.lead_id}>
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
