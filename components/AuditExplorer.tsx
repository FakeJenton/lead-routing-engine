"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import ScoreBars from "@/components/ScoreBars";
import {
  bandWord,
  Decision,
  fmtMinutes,
  methodLabel,
  nextStep,
  repName,
  ruleLabel,
  signalValue,
  sourceLabel,
  statusLabel,
  SIGNALS,
} from "@/lib/snapshot";

const PAGE = 40;

function CopyLink({ leadId }: { leadId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="copy-link"
      onClick={(e) => {
        e.stopPropagation();
        const url = `${window.location.origin}${window.location.pathname}?lead=${leadId}`;
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? "Link copied ✓" : "Copy link to this lead"}
    </button>
  );
}

// Turn the filtered view into a spreadsheet-friendly file, same plain-English
// labels as the screen.
function downloadCsv(rows: Decision[]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "Lead ID", "Company", "Segment", "Region", "Score", "Temperature",
    "Company match", "Rule applied", "Went to", "Outcome", "Time to assign",
    "Why", "Next step",
  ];
  const lines = rows.map((d) =>
    [
      d.lead_id, d.company, d.segment, d.region, d.score, bandWord(d.band),
      methodLabel(d.match_method), ruleLabel(d.rule_fired),
      repName(d.assigned_rep_id) ?? "", statusLabel(d.status),
      fmtMinutes(d.time_in_queue_min), d.reason, nextStep(d),
    ].map(esc).join(",")
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "routing-decisions.csv";
  a.click();
  URL.revokeObjectURL(a.href);
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
            <ScoreBars
              rows={SIGNALS.map((s) => ({
                key: s.key,
                value: signalValue(d, s.key),
                pts: d.score_breakdown?.[s.key] ?? 0,
              }))}
            />
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
              <dd>{sourceLabel(d.source)}</dd>
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
            <CopyLink leadId={d.lead_id} />
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
  const [sort, setSort] = useState("arrival");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Deep link: /?lead=L000123 opens that lead's full story directly.
  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get("lead");
    if (!leadId) return;
    const idx = decisions.findIndex((d) => d.lead_id === leadId);
    if (idx === -1) return;
    setLimit(Math.max(PAGE, Math.ceil((idx + 1) / PAGE) * PAGE));
    setExpanded(leadId);
    setTimeout(() => {
      document.getElementById(`lead-${leadId}`)?.scrollIntoView({ block: "center" });
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = (leadId: string) => {
    const next = expanded === leadId ? null : leadId;
    setExpanded(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("lead", next);
    else url.searchParams.delete("lead");
    window.history.replaceState(null, "", url.toString());
  };

  const rules = useMemo(
    () => Array.from(new Set(decisions.map((d) => d.rule_fired))).sort(),
    [decisions]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = decisions.filter((d) => {
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
    // Missing wait times (nurture leads) always sort to the end.
    const wait = (d: Decision) => d.time_in_queue_min ?? -Infinity;
    if (sort === "score_high") out.sort((a, b) => b.score - a.score);
    else if (sort === "score_low") out.sort((a, b) => a.score - b.score);
    else if (sort === "longest_wait") out.sort((a, b) => wait(b) - wait(a));
    else if (sort === "company") out.sort((a, b) => a.company.localeCompare(b.company));
    return out;
  }, [decisions, q, status, segment, rule, sort]);

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
        <select value={sort} onChange={(e) => { setSort(e.target.value); setLimit(PAGE); }}>
          <option value="arrival">In order of arrival</option>
          <option value="score_high">Highest score first</option>
          <option value="score_low">Lowest score first</option>
          <option value="longest_wait">Longest wait first</option>
          <option value="company">Company A to Z</option>
        </select>
        <button className="csv-btn" onClick={() => downloadCsv(filtered)}>
          Download this view (CSV)
        </button>
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
                  id={`lead-${d.lead_id}`}
                  className={`row-click ${expanded === d.lead_id ? "open" : ""}`}
                  onClick={() => toggleExpand(d.lead_id)}
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
