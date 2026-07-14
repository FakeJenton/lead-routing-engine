"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import ScoreBars from "@/components/ScoreBars";
import {
  AlertFilter,
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

export type ActiveAlertFilter = AlertFilter & { chip: string };

const PAGE = 40;

// A dropdown of checkboxes, so filters can be combined however the reader
// wants (e.g. "Stuck + Nurture" or two rules at once). Empty selection = all.
function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string; // e.g. "outcomes" — shown as "All outcomes" when nothing picked
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const toggle = (value: string) =>
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );

  const cap = label[0].toUpperCase() + label.slice(1);
  const text =
    selected.length === 0
      ? `All ${label}`
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : `${cap}: ${selected.length} picked`;

  return (
    <div className="msel" ref={ref}>
      <button
        type="button"
        className={`msel-btn ${selected.length ? "active" : ""}`}
        onClick={() => setOpen(!open)}
      >
        {text} <span className="msel-caret">▾</span>
      </button>
      {open && (
        <div className="msel-panel">
          {options.map((o) => (
            <label className="msel-opt" key={o.value}>
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              {o.label}
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" className="msel-clear" onClick={() => onChange([])}>
              Clear — show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
    "Company match", "Rule applied", "Went to", "Outcome", "Time to first contact",
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
      <td colSpan={10}>
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
              <dt>Time to first contact</dt>
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

type SortKey =
  | "arrival" | "company" | "segment" | "score" | "wait"
  | "match" | "rule" | "rep" | "outcome";

export default function AuditExplorer({
  decisions,
  statuses,
  onStatusesChange,
  alertFilter,
  onClearAlertFilter,
}: {
  decisions: Decision[];
  statuses: string[];
  onStatusesChange: (s: string[]) => void;
  alertFilter: ActiveAlertFilter | null;
  onClearAlertFilter: () => void;
}) {
  const [q, setQ] = useState("");
  const [segments, setSegments] = useState<string[]>([]);
  const [rulesPicked, setRulesPicked] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("arrival");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Click a header to sort by it; click again to flip the direction.
  const sortBy = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Sensible first direction: big numbers first, names A to Z.
      setSortDir(key === "score" || key === "wait" ? "desc" : "asc");
    }
    setLimit(PAGE);
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? <span className="arrow">{sortDir === "asc" ? "▲" : "▼"}</span> : null;

  const Th = ({ k, children, title }: { k: SortKey; children: React.ReactNode; title: string }) => (
    <th className="sortable" onClick={() => sortBy(k)} title={title}>
      {children}
      {arrow(k)}
    </th>
  );

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

  // When an alert is clicked, its filter becomes the whole view: clear the
  // manual filters so the count matches the number in the alert exactly.
  useEffect(() => {
    if (!alertFilter) return;
    setQ("");
    setSegments([]);
    setRulesPicked([]);
    onStatusesChange([]);
    setLimit(PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertFilter]);

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
    const af = alertFilter;
    // Empty selection means "all" for every multi-select filter.
    const out = decisions.filter((d) => {
      if (af) {
        if (af.statuses && !af.statuses.includes(d.status)) return false;
        if (af.rules && !af.rules.includes(d.rule_fired)) return false;
        if (af.min_wait_min != null && (d.time_in_queue_min ?? 0) <= af.min_wait_min)
          return false;
        if (af.band && d.band !== af.band) return false;
        if (af.match && d.match_method !== af.match) return false;
        if (af.overridden && !d.manual_override) return false;
        if (af.q) {
          const hay = `${repName(d.assigned_rep_id) ?? ""} ${d.reason}`.toLowerCase();
          if (!hay.includes(af.q.toLowerCase())) return false;
        }
      }
      if (statuses.length && !statuses.includes(d.status)) return false;
      if (segments.length && !segments.includes(d.segment)) return false;
      if (rulesPicked.length && !rulesPicked.includes(d.rule_fired)) return false;
      if (needle) {
        const hay = `${d.lead_id} ${d.company} ${repName(d.assigned_rep_id) ?? ""} ${
          d.matched_account_id ?? ""
        } ${d.reason}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    // Leads with no wait time (nurture, never assigned) always sort last.
    const wait = (d: Decision) =>
      d.time_in_queue_min ?? (sortDir === "asc" ? Infinity : -Infinity);
    // Text columns sort by what the reader sees on screen, not the raw keys.
    const text: Partial<Record<SortKey, (d: Decision) => string>> = {
      company: (d) => d.company,
      segment: (d) => `${d.segment} ${d.region}`,
      match: (d) => methodLabel(d.match_method),
      rule: (d) => ruleLabel(d.rule_fired),
      rep: (d) => repName(d.assigned_rep_id) ?? "￿", // unassigned last
      outcome: (d) => statusLabel(d.status),
    };
    if (sortKey === "score") out.sort((a, b) => dir * (a.score - b.score));
    else if (sortKey === "wait") out.sort((a, b) => dir * (wait(a) - wait(b)));
    else if (text[sortKey]) {
      const get = text[sortKey]!;
      out.sort((a, b) => dir * get(a).localeCompare(get(b)));
    } else if (sortDir === "desc") out.reverse(); // arrival, newest first
    return out;
  }, [decisions, q, statuses, segments, rulesPicked, sortKey, sortDir, alertFilter]);

  const shown = filtered.slice(0, limit);

  return (
    <div>
      {alertFilter && (
        <div className="afilter">
          <span>
            Showing only leads that were <strong>{alertFilter.chip}</strong> —{" "}
            {filtered.length.toLocaleString()} lead{filtered.length === 1 ? "" : "s"}
          </span>
          <button onClick={onClearAlertFilter}>Clear ✕ show all leads</button>
        </div>
      )}
      <div className="controls">
        <input
          placeholder="Search by company, lead ID, rep name, or reason..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
        />
        <MultiSelect
          label="outcomes"
          options={[
            { value: "routed", label: "Routed to a rep" },
            { value: "nurture", label: "Nurture list" },
            { value: "unrouted", label: "Stuck (no rep)" },
          ]}
          selected={statuses}
          onChange={(next) => {
            onStatusesChange(next);
            setLimit(PAGE);
          }}
        />
        <MultiSelect
          label="segments"
          options={[
            { value: "SMB", label: "SMB" },
            { value: "MidMarket", label: "MidMarket" },
            { value: "Enterprise", label: "Enterprise" },
          ]}
          selected={segments}
          onChange={(next) => {
            setSegments(next);
            setLimit(PAGE);
          }}
        />
        <MultiSelect
          label="rules"
          options={rules.map((r) => ({ value: r, label: ruleLabel(r) }))}
          selected={rulesPicked}
          onChange={(next) => {
            setRulesPicked(next);
            setLimit(PAGE);
          }}
        />
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
              <Th k="arrival" title="Sort by arrival order">Lead</Th>
              <Th k="company" title="Sort by company name">Company</Th>
              <Th k="segment" title="Sort by segment and region">Segment / Region</Th>
              <Th k="score" title="Sort by score">Score</Th>
              <Th k="wait" title="Sort by time from lead to first contact">First contact</Th>
              <Th k="match" title="Sort by how the company was recognized">Match</Th>
              <Th k="rule" title="Sort by the rule applied">Rule applied</Th>
              <Th k="rep" title="Sort by rep name">Went to</Th>
              <Th k="outcome" title="Sort by outcome">Outcome</Th>
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
                  <td style={{ whiteSpace: "nowrap" }}>{fmtMinutes(d.time_in_queue_min)}</td>
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
