import AuditExplorer from "@/components/AuditExplorer";
import { snapshot, pct, ruleLabel, methodLabel } from "@/lib/snapshot";

const s = snapshot.summary;

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
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
  const rules = snapshot.rules.map((r) => ({
    name: ruleLabel(r.rule),
    count: r.count,
    key: r.rule,
  }));
  const methods = snapshot.match_methods
    .map((m) => ({ name: methodLabel(m.method), count: m.count, key: m.method }))
    .sort((a, b) => b.count - a.count);

  const bandColor = (name: string) =>
    name.startsWith("A") ? "good" : name.startsWith("B") ? "" : name.startsWith("D") ? "warn" : "mut";

  const repMaxLoad = Math.max(...snapshot.reps.map((r) => r.load), 1);

  return (
    <>
      <div className="page-head">
        <h1>Routing health dashboard</h1>
        <p>
          One run of the routing engine over {s.total.toLocaleString()} synthetic
          inbound leads for an early-education GTM motion. Each lead is scored,
          matched against a book of {s.num_accounts} accounts, and routed through
          an ordered rule graph across {s.num_reps} reps. Every decision is
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
            resting period <strong>{s.resting_period_days}d</strong>
          </span>
          <span className="chip">
            SLA <strong>{s.sla_minutes}m</strong>
          </span>
        </div>
      </div>

      {/* KPIs */}
      <div className="section">
        <div className="grid cols-5">
          <Kpi
            label="Routed"
            value={pct(s.routed / s.total)}
            sub={`${s.routed.toLocaleString()} leads`}
            tone="good"
          />
          <Kpi
            label="Account match rate"
            value={pct(s.match_rate)}
            sub={`${s.matched.toLocaleString()} matched`}
          />
          <Kpi
            label="Speed-to-lead p50"
            value={`${s.speed_p50}m`}
            sub={`p90 ${s.speed_p90}m · p99 ${s.speed_p99}m`}
          />
          <Kpi
            label="Nurture (low score)"
            value={pct(s.nurture / s.total)}
            sub={`${s.nurture.toLocaleString()} parked`}
            tone="warn"
          />
          <Kpi
            label="Unrouted"
            value={pct(s.unrouted / s.total)}
            sub={`${s.unrouted.toLocaleString()} escalated`}
            tone={s.unrouted > 0 ? "bad" : "good"}
          />
        </div>
      </div>

      {/* Alerts */}
      <div className="section">
        <h2>Guardrail alerts</h2>
        <div className="card card-pad">
          {snapshot.alerts.length === 0 ? (
            <div className="ok-note">All guardrails within thresholds. No alerts.</div>
          ) : (
            snapshot.alerts.map((a, i) => (
              <div className={`alert ${a.level}`} key={i}>
                <span className="ico">{a.level === "critical" ? "🚨" : "⚠️"}</span>
                <span className="txt">
                  <span className="lvl">{a.level}</span>
                  {a.text}
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
            <h2 style={{ marginTop: 0 }}>Routing decisions by rule</h2>
            <BarList
              items={rules}
              colorFor={(name) =>
                name.startsWith("Unrouted")
                  ? "bad"
                  : name.startsWith("Nurture")
                  ? "warn"
                  : name.startsWith("Region overflow")
                  ? "mut"
                  : ""
              }
            />
          </div>
          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Account match method</h2>
            <BarList
              items={methods}
              colorFor={(name) => (name.startsWith("No match") ? "mut" : "good")}
            />
            <p style={{ color: "var(--ink-2)", fontSize: 13, marginBottom: 0 }}>
              Matching runs domain → exact name → state-gated fuzzy name. Personal
              email domains are excluded from domain matching.
            </p>
          </div>
        </div>
      </div>

      {/* Distribution + score bands */}
      <div className="section">
        <div className="grid cols-2">
          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Distribution across reps</h2>
            <div>
              {snapshot.reps.map((r) => (
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
              Load includes owner-based continuity plus round-robin. Skew alerts
              evaluate only native round-robin, since ownership cannot be
              rebalanced.
            </p>
          </div>
          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>Lead score bands</h2>
            <BarList
              items={snapshot.score_bands.map((b) => ({
                name: `Band ${b.band}`,
                count: b.count,
              }))}
              colorFor={(name) => bandColor(name.replace("Band ", ""))}
            />
            <p style={{ color: "var(--ink-2)", fontSize: 13, marginBottom: 0 }}>
              A-band leads prefer a senior rep in the queue. D-band leads park in
              nurture instead of consuming capacity. The score is a routing input,
              not a separate report.
            </p>
          </div>
        </div>
      </div>

      {/* Audit explorer */}
      <div className="section">
        <h2>Audit trail explorer</h2>
        <div className="card card-pad">
          <p style={{ marginTop: 0, color: "var(--ink-2)", fontSize: 13.5 }}>
            Every routing decision, with the rule that fired and a plain-language
            reason. Filter and search to answer &ldquo;why did this lead go
            there?&rdquo; for any single lead.
          </p>
          <AuditExplorer decisions={snapshot.decisions} />
        </div>
      </div>
    </>
  );
}
