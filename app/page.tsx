"use client";

import { useState } from "react";
import AuditExplorer from "@/components/AuditExplorer";
import { bandWord, fmtMinutes, methodLabel, pct, ruleLabel, snapshot, SIGNALS } from "@/lib/snapshot";

const s = snapshot.summary;

function Kpi({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
  onClick?: () => void;
}) {
  return (
    <div
      className={`card kpi ${onClick ? "clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
      {onClick && <div className="kpi-link">View in audit trail →</div>}
    </div>
  );
}

function BarList({
  items,
  colorFor,
}: {
  items: { name: string; count: number }[];
  colorFor?: (name: string, i: number) => string;
}) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="barlist">
      {items.map((it, i) => (
        <div className="barrow" key={it.name}>
          <div className="top" style={{ gridColumn: "1 / -1" }}>
            <span className="name">{it.name}</span>
            <span className="count">{it.count.toLocaleString()}</span>
          </div>
          <div className="track">
            <div
              className={`fill ${colorFor ? colorFor(it.name, i) : ""}`}
              style={{ width: `${(it.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [auditStatuses, setAuditStatuses] = useState<string[]>([]);
  const [showGuide, setShowGuide] = useState(true);
  const [repSort, setRepSort] = useState<"team" | "most" | "name">("team");

  // "team" keeps the roster's natural grouping (segment, then region).
  const sortedReps =
    repSort === "most"
      ? [...snapshot.reps].sort((a, b) => b.load - a.load)
      : repSort === "name"
      ? [...snapshot.reps].sort((a, b) => a.name.localeCompare(b.name))
      : snapshot.reps;

  const jumpToAudit = (status: string) => {
    setAuditStatuses([status]);
    document.getElementById("audit")?.scrollIntoView({ behavior: "smooth" });
  };

  const rules = snapshot.rules.map((r) => ({
    name: ruleLabel(r.rule),
    count: r.count,
    key: r.rule,
  }));
  const methods = snapshot.match_methods
    .map((m) => ({ name: methodLabel(m.method), count: m.count, key: m.method }))
    .sort((a, b) => b.count - a.count);

  const repMaxLoad = Math.max(...snapshot.reps.map((r) => r.load), 1);
  const generated = new Date(snapshot.generated_at);

  return (
    <>
      <div className="page-head">
        <h1>Routing health dashboard</h1>
        <p>
          One run of the routing engine over {s.total.toLocaleString()} synthetic
          inbound leads for a B2B SaaS pipeline. Each lead is scored, matched
          against a book of {s.num_accounts} accounts, and routed through an
          ordered rule graph across {s.num_reps} reps. Every decision is
          auditable below.
        </p>
        <div className="tagrow">
          <span className="chip">
            <strong>{s.total.toLocaleString()}</strong> leads routed
          </span>
          <span className="chip">
            <strong>{s.num_accounts}</strong> accounts
          </span>
          <span className="chip">
            <strong>{s.num_reps}</strong> reps across SMB / MidMarket / Enterprise
          </span>
          <span className="chip">
            ownership expires after <strong>{s.resting_period_days} days</strong> idle
          </span>
          <span className="chip">
            goal: rep assigned within <strong>{s.sla_minutes} min</strong>
          </span>
          <span className="chip">
            data from <strong>{generated.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</strong>
          </span>
        </div>
      </div>

      {/* Start-here guide */}
      {showGuide && (
        <div className="guide card">
          <button className="guide-hide" onClick={() => setShowGuide(false)}>
            Hide guide ✕
          </button>
          <div className="guide-kicker">Start here · 2-minute scan</div>
          <ol className="guide-steps">
            <li>
              <strong>Scan the top numbers</strong> — are leads reaching reps
              quickly, or getting stuck along the way?
            </li>
            <li>
              <strong>Read the alerts</strong> — each one says what went wrong
              and what to do about it.
            </li>
            <li>
              <strong>Trace one lead end-to-end</strong> — click any row in the
              audit trail to see its score, how the company was recognized, the
              rule applied, and the recommended next step.
            </li>
            <li>
              <strong>Try a lead yourself</strong> — the simulator walks a
              made-up lead through every rule, live.
            </li>
          </ol>
        </div>
      )}

      {/* KPIs */}
      <div className="section">
        <div className="grid cols-5">
          <Kpi
            label="Sent to a rep"
            value={pct(s.routed / s.total)}
            sub={`${s.routed.toLocaleString()} leads reached a person`}
            tone="good"
            onClick={() => jumpToAudit("routed")}
          />
          <Kpi
            label="Known companies"
            value={pct(s.match_rate)}
            sub={`${s.matched.toLocaleString()} matched a company we already know`}
          />
          <Kpi
            label="Typical time to assign"
            value={fmtMinutes(s.speed_p50)}
            sub={`9 in 10 within ${fmtMinutes(s.speed_p90)} · slowest ${fmtMinutes(s.speed_p99)}`}
          />
          <Kpi
            label="On the nurture list"
            value={pct(s.nurture / s.total)}
            sub={`${s.nurture.toLocaleString()} low-score leads in email follow-up`}
            tone="warn"
            onClick={() => jumpToAudit("nurture")}
          />
          <Kpi
            label="Stuck — no rep free"
            value={pct(s.unrouted / s.total)}
            sub={`${s.unrouted.toLocaleString()} waiting for a manager`}
            tone={s.unrouted > 0 ? "bad" : "good"}
            onClick={() => jumpToAudit("unrouted")}
          />
        </div>
      </div>

      {/* Alerts */}
      <div className="section">
        <h2>What needs attention</h2>
        <div className="card card-pad">
          {snapshot.alerts.length === 0 ? (
            <div className="ok-note">Everything looks healthy today. No action needed.</div>
          ) : (
            snapshot.alerts.map((a, i) => (
              <div className={`alert ${a.level}`} key={i}>
                <span className="ico">{a.level === "critical" ? "🚨" : "⚠️"}</span>
                <span className="txt">
                  <span className="lvl">{a.level === "critical" ? "Act today" : "Worth a look"}</span>
                  {a.text}
                  <span className="alert-action">
                    <strong>What to do:</strong> {a.action}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Rules + match methods */}
      <div className="section">
        <div className="grid cols-2">
          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Where leads went, and why</h2>
            <BarList
              items={rules}
              colorFor={(name) =>
                name.startsWith("Stuck")
                  ? "bad"
                  : name.startsWith("Low score")
                  ? "warn"
                  : name.startsWith("Home team full")
                  ? "mut"
                  : ""
              }
            />
          </div>
          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>How companies were recognized</h2>
            <BarList
              items={methods}
              colorFor={(name) => (name.startsWith("New company") ? "mut" : "good")}
            />
            <p style={{ color: "var(--ink-2)", fontSize: 13, marginBottom: 0 }}>
              We first check the lead&apos;s company email address, then the exact
              company name, then similar spellings (only when the state also
              matches). Personal addresses like gmail can&apos;t identify a company,
              so those fall back to name checks.
            </p>
          </div>
        </div>
      </div>

      {/* Distribution + score bands */}
      <div className="section">
        <div className="grid cols-2">
          <div className="card card-pad">
            <div className="card-head-row">
              <h2 style={{ margin: 0 }}>Who received the leads</h2>
              <div className="mini-sort">
                {(
                  [
                    ["team", "By team"],
                    ["most", "Most leads"],
                    ["name", "Name"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={repSort === key ? "on" : ""}
                    onClick={() => setRepSort(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              {sortedReps.map((r) => (
                <div className="rep" key={r.rep_id}>
                  <div className="who">
                    <span className="nm">
                      {r.name}
                      {r.is_ramping && <span className="badge ramp">RAMPING</span>}
                      {r.seniority === "senior" && <span className="badge snr">SR</span>}
                    </span>
                    <span className="mt">
                      {r.segment} · {r.region}
                    </span>
                  </div>
                  <div className="track">
                    <div
                      className="fill"
                      style={{ width: `${(r.load / repMaxLoad) * 100}%` }}
                    />
                  </div>
                  <div className="load">
                    {r.load} <span style={{ color: "var(--ink-3)" }}>/ {r.capacity}</span>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ color: "var(--ink-2)", fontSize: 12.5, marginBottom: 0 }}>
              Counts include leads a rep kept because they already own the
              account, which is why some reps sit above their shared-pool limit.
              Fairness checks only look at the shared pool, since account
              ownership can&apos;t be rebalanced.
            </p>
          </div>
          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Lead temperature</h2>
            <p style={{ color: "var(--ink-2)", fontSize: 13, marginTop: 0 }}>
              Every lead gets a 0–100 score, and the score decides the route.
              It isn&apos;t just a report.
            </p>
            <div className="temp-list">
              {(
                [
                  ["A", "75+", "good", "Skips the line — goes straight to a senior rep. Call within 5 minutes."],
                  ["B", "50–74", "brand", "Assigned right away; the rep follows up the same day."],
                  ["C", "30–49", "mut", "Assigned to the normal rotation — worked in due course."],
                  ["D", "under 30", "warn", "Not sent to anyone. Goes to the automated nurture list until it warms up."],
                ] as const
              ).map(([band, range, tone, meaning]) => {
                const count = snapshot.score_bands.find((b) => b.band === band)?.count ?? 0;
                const max = Math.max(...snapshot.score_bands.map((b) => b.count), 1);
                return (
                  <div className="temp-row" key={band}>
                    <div className="temp-top">
                      <span className="temp-name">
                        {bandWord(band)} <em>(score {range})</em>
                      </span>
                      <span className="temp-count">
                        {count.toLocaleString()}
                        <em> · {Math.round((count / s.total) * 100)}% of leads</em>
                      </span>
                    </div>
                    <div className="track">
                      <div
                        className={`fill ${tone === "brand" ? "" : tone}`}
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                    <div className="temp-meaning">{meaning}</div>
                  </div>
                );
              })}
            </div>
            <div className="ingredients">
              <h3>What builds the score</h3>
              {SIGNALS.map((sig) => (
                <div className="ing-row" key={sig.key}>
                  <span className="ing-name">
                    {sig.label} <em>({sig.tech})</em>
                  </span>
                  <div className="track">
                    <div className="fill" style={{ width: `${(sig.max / 30) * 100}%` }} />
                  </div>
                  <span className="ing-pts">up to {sig.max} pts</span>
                </div>
              ))}
              <p className="ing-note">
                Click any lead in the table below to see these five ingredients
                scored for that lead.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Audit explorer */}
      <div className="section" id="audit">
        <h2>Every decision, explained</h2>
        <div className="card card-pad">
          <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: 13.5 }}>
            Each row is one lead and the plain-English reason it went where it
            went. Click a row to see the full story: why it got its score, how
            the company was recognized, and the recommended next step.
          </p>
          <AuditExplorer
            decisions={snapshot.decisions}
            statuses={auditStatuses}
            onStatusesChange={setAuditStatuses}
          />
        </div>
      </div>
    </>
  );
}
