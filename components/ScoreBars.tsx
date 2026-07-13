"use client";

import { SIGNALS } from "@/lib/snapshot";

export type ScoreBarRow = {
  key: string;
  value: string; // the actual logged value, e.g. "Executive"
  pts: number;
};

// One rendering of the five scoring signals, shared by the audit drill-down
// and the simulator so the vocabulary can never drift between pages. Each row
// reads: plain name (technical term): actual value, then the points earned.
export default function ScoreBars({ rows }: { rows: ScoreBarRow[] }) {
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  return (
    <div className="bd">
      {SIGNALS.map((s) => {
        const row = byKey[s.key];
        const pts = row?.pts ?? 0;
        return (
          <div className="bd-row" key={s.key}>
            <div className="bd-label">
              <span className="bd-name">
                {s.label} <em>({s.tech})</em>
              </span>
              <span className="bd-value">{row?.value ?? "—"}</span>
            </div>
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
