"use client";

import raw from "@/public/data/trends.json";
import { fmtMinutes } from "@/lib/snapshot";

type Week = {
  week: string;
  routed_pct: number;
  match_rate: number;
  assign_p50_min: number;
  stuck: number;
  override_pct: number;
  slow_pct: number;
};

const trends = raw as { generated_at: string; sla_minutes: number; weeks: Week[] };
const weeks = trends.weeks;

type MetricDef = {
  key: keyof Week;
  title: string;
  caption: string;
  fmt: (v: number) => string;
  higherIsBetter: boolean;
  // how big a relative move counts as "worth mentioning"
  threshold: number;
  actionWhenWorse: string;
  actionWhenBetter: string;
  actionWhenSteady: string;
};

const METRICS: MetricDef[] = [
  {
    key: "routed_pct",
    title: "Leads that reached a rep",
    caption: "Share of the week's leads that ended up with a person.",
    fmt: (v) => `${Math.round(v * 100)}%`,
    higherIsBetter: true,
    threshold: 0.03,
    actionWhenWorse: "Find out where the drop went: the stuck queue or the nurture list.",
    actionWhenBetter: "Whatever changed is working. Note it before it gets lost.",
    actionWhenSteady: "Healthy and steady. No action needed.",
  },
  {
    key: "match_rate",
    title: "Companies we recognized",
    caption: "Share of leads matched to a company already in the book.",
    fmt: (v) => `${Math.round(v * 100)}%`,
    higherIsBetter: true,
    threshold: 0.03,
    actionWhenWorse: "Review the company-name cleanup rules; duplicates may be creeping in.",
    actionWhenBetter: "Recognition is improving. Keep the current matching rules.",
    actionWhenSteady: "Steady. Spot-check a few 'new company' leads monthly for missed matches.",
  },
  {
    key: "assign_p50_min",
    title: "Typical time to assign",
    caption: "How long the middle-of-the-pack lead waited for a rep.",
    fmt: (v) => fmtMinutes(v),
    higherIsBetter: false,
    threshold: 0.2,
    actionWhenWorse: "Leads are waiting longer. Check rep availability and team limits.",
    actionWhenBetter: "Assignment is getting faster. Nothing to fix.",
    actionWhenSteady: "Consistently fast. No action needed.",
  },
  {
    key: "stuck",
    title: "Stuck leads",
    caption: "Leads nobody could take because every eligible rep was full.",
    fmt: (v) => `${Math.round(v)}`,
    higherIsBetter: false,
    threshold: 0.35,
    actionWhenWorse: "Capacity problem. Raise team lead limits or add a rep where leads pile up.",
    actionWhenBetter: "Fewer leads left waiting. Keep an eye on it after any roster change.",
    actionWhenSteady: "A steady trickle of stuck leads means a steady capacity gap. Fix the bottleneck team.",
  },
  {
    key: "override_pct",
    title: "Manual re-assignments",
    caption: "How often a manager moved a lead somewhere the rules didn't.",
    fmt: (v) => `${Math.round(v * 100)}%`,
    higherIsBetter: false,
    threshold: 0.25,
    actionWhenWorse: "Managers are fighting the rules. Ask which rule they keep correcting, then change it.",
    actionWhenBetter: "The rules are earning trust. Fewer corrections needed.",
    actionWhenSteady: "A small, steady share of corrections is normal. Review the reasons quarterly.",
  },
  {
    key: "slow_pct",
    title: "Slow assignments",
    caption: `Share of routed leads that waited longer than the ${trends.sla_minutes}-minute goal.`,
    fmt: (v) => `${Math.round(v * 100)}%`,
    higherIsBetter: false,
    threshold: 0.25,
    actionWhenWorse: "More leads are missing the speed goal. Check for a slow team or time-of-day gaps.",
    actionWhenBetter: "Speed is improving against the goal.",
    actionWhenSteady: "Stable. Consider tightening the goal if the team keeps beating it.",
  },
];

function insight(def: MetricDef): { text: string; action: string; tone: "good" | "bad" | "flat" } {
  const values = weeks.map((w) => Number(w[def.key]));
  const last = values[values.length - 1];
  const prior = values.slice(0, -1);
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  const rel = avg === 0 ? (last === 0 ? 0 : 1) : (last - avg) / Math.abs(avg);

  if (Math.abs(rel) < def.threshold) {
    return {
      text: `Holding steady around ${def.fmt(avg)} for the last 12 weeks.`,
      action: def.actionWhenSteady,
      tone: "flat",
    };
  }
  const moved = rel > 0 ? "up" : "down";
  const improved = rel > 0 === def.higherIsBetter;
  return {
    text: `This week came in at ${def.fmt(last)}, ${moved} from a 12-week average of ${def.fmt(avg)}.`,
    action: improved ? def.actionWhenBetter : def.actionWhenWorse,
    tone: improved ? "good" : "bad",
  };
}

function MiniBars({ def }: { def: MetricDef }) {
  const values = weeks.map((w) => Number(w[def.key]));
  const max = Math.max(...values, 0.0001);
  const lastIdx = values.length - 1;
  return (
    <div className="spark" role="img" aria-label={`${def.title} by week`}>
      {values.map((v, i) => (
        <div className="spark-col" key={i} title={`Week of ${weeks[i].week}: ${def.fmt(v)}`}>
          <div
            className={`spark-bar ${i === lastIdx ? "current" : ""}`}
            style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function Trends() {
  return (
    <>
      <div className="page-head">
        <h1>12-week trends</h1>
        <p>
          The same routing pipeline, run weekly. Each card shows the last 12
          weeks, what changed, and what to do about it. The highlighted bar is
          the most recent week ({weeks[weeks.length - 1].week}).
        </p>
      </div>

      <div className="section grid cols-2">
        {METRICS.map((def) => {
          const ins = insight(def);
          const last = Number(weeks[weeks.length - 1][def.key]);
          return (
            <div className="card card-pad trend-card" key={def.key}>
              <div className="trend-head">
                <div>
                  <h2 style={{ margin: 0 }}>{def.title}</h2>
                  <p className="trend-caption">{def.caption}</p>
                </div>
                <div className={`trend-now ${ins.tone}`}>{def.fmt(last)}</div>
              </div>
              <MiniBars def={def} />
              <div className="trend-axis">
                <span>{weeks[0].week}</span>
                <span>{weeks[weeks.length - 1].week}</span>
              </div>
              <p className="trend-insight">{ins.text}</p>
              <p className="detail-action" style={{ marginTop: 6 }}>
                <strong>What to do:</strong> {ins.action}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}
