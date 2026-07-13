"use client";

import { useMemo, useState } from "react";
import ScoreBars from "@/components/ScoreBars";
import { bandWord, sourceLabel, SOURCE_OPTIONS, statusLabel } from "@/lib/snapshot";
import { simulate, segmentFor, SimInput } from "@/lib/simulate";

const DEFAULTS: SimInput = {
  employees: 250,
  seniority: "director",
  source: "demo_request",
  pagesViewed: 8,
  trialStarted: false,
  daysSinceTouch: 0,
  region: "West",
  relationship: "new",
};

export default function Simulator() {
  const [input, setInput] = useState<SimInput>(DEFAULTS);
  const result = useMemo(() => simulate(input), [input]);

  const set = <K extends keyof SimInput>(k: K, v: SimInput[K]) =>
    setInput((prev) => ({ ...prev, [k]: v }));

  return (
    <>
      <div className="page-head">
        <h1>Try a lead</h1>
        <p>
          Describe a made-up lead and watch it walk through the routing rules,
          live. Change anything on the left and the decision updates instantly,
          the same logic that routed the 1,000 leads on the dashboard.
        </p>
      </div>

      <div className="sim-grid section">
        {/* Inputs */}
        <div className="card card-pad sim-form">
          <h2 style={{ marginTop: 0 }}>The lead</h2>

          <label className="f-label">
            Company size
            <select
              value={input.employees}
              onChange={(e) => set("employees", Number(e.target.value))}
            >
              <option value={10}>Small — about 10 people</option>
              <option value={60}>Growing — about 60 people</option>
              <option value={250}>Mid-size — about 250 people</option>
              <option value={900}>Large — about 900 people</option>
              <option value={3000}>Enterprise — 3,000+ people</option>
            </select>
            <span className="f-hint">
              Puts it on the <strong>{segmentFor(input.employees)}</strong> team
            </span>
          </label>

          <label className="f-label">
            Who reached out
            <select
              value={input.seniority}
              onChange={(e) => set("seniority", e.target.value as SimInput["seniority"])}
            >
              <option value="executive">CEO / founder</option>
              <option value="director">VP or department head</option>
              <option value="manager">Manager</option>
              <option value="individual">Individual contributor</option>
            </select>
          </label>

          <label className="f-label">
            How they found us
            <select value={input.source} onChange={(e) => set("source", e.target.value)}>
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="f-label">
            Pages viewed on our site
            <select
              value={input.pagesViewed}
              onChange={(e) => set("pagesViewed", Number(e.target.value))}
            >
              <option value={0}>None</option>
              <option value={3}>A few (3)</option>
              <option value={8}>Several (8)</option>
              <option value={20}>A lot (20+)</option>
            </select>
          </label>

          <label className="f-check">
            <input
              type="checkbox"
              checked={input.trialStarted}
              onChange={(e) => set("trialStarted", e.target.checked)}
            />
            They started a free trial
          </label>

          <label className="f-label">
            Last activity
            <select
              value={input.daysSinceTouch}
              onChange={(e) => set("daysSinceTouch", Number(e.target.value))}
            >
              <option value={0}>Today</option>
              <option value={5}>About a week ago</option>
              <option value={20}>About three weeks ago</option>
              <option value={60}>Two months ago or more</option>
            </select>
          </label>

          <label className="f-label">
            Region
            <select
              value={input.region}
              onChange={(e) => set("region", e.target.value as SimInput["region"])}
            >
              <option value="West">US — West</option>
              <option value="Central">US — Central</option>
              <option value="East">US — East</option>
              <option value="INTL">Outside the US</option>
            </select>
          </label>

          <label className="f-label">
            Do we already know this company?
            <select
              value={input.relationship}
              onChange={(e) => set("relationship", e.target.value as SimInput["relationship"])}
            >
              <option value="new">No — brand new to us</option>
              <option value="customer">Yes — already a customer</option>
              <option value="open_opp">Yes — a deal is in progress</option>
              <option value="owned_active">Yes — a rep worked it recently</option>
              <option value="owned_stale">Yes — but untouched for 100+ days</option>
            </select>
          </label>
        </div>

        {/* Outcome */}
        <div className="sim-result">
          <div className={`card card-pad sim-outcome ${result.finalStatus}`}>
            <div className="sim-outcome-kicker">
              Outcome: <span className={`pill ${result.finalStatus}`}>{statusLabel(result.finalStatus)}</span>
            </div>
            <div className="sim-headline">{result.finalHeadline}</div>
            <p className="sim-expl">{result.finalExplanation}</p>
            <p className="detail-action">
              <strong>Next step:</strong> {result.nextStep}
            </p>
            <p className="sim-whynot">
              <strong>What would have changed this?</strong> {result.whyNot}
            </p>
          </div>

          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>
              Score: {result.score.total} / 100 ({bandWord(result.score.band)})
            </h2>
            <ScoreBars
              rows={[
                { key: "source_intent", value: sourceLabel(input.source), pts: result.score.breakdown.source_intent },
                {
                  key: "behavioral",
                  value: `${input.pagesViewed} page${input.pagesViewed === 1 ? "" : "s"} viewed${input.trialStarted ? " · started a trial" : ""}`,
                  pts: result.score.breakdown.behavioral,
                },
                {
                  key: "seniority",
                  value: input.seniority[0].toUpperCase() + input.seniority.slice(1),
                  pts: result.score.breakdown.seniority,
                },
                {
                  key: "firmographic",
                  value: `${input.employees.toLocaleString()} employees`,
                  pts: result.score.breakdown.firmographic,
                },
                {
                  key: "recency",
                  value:
                    input.daysSinceTouch === 0
                      ? "Active today"
                      : input.daysSinceTouch === 1
                      ? "Active yesterday"
                      : `Last active ${input.daysSinceTouch} days ago`,
                  pts: result.score.breakdown.recency,
                },
              ]}
            />
          </div>

          <div className="card card-pad">
            <h2 style={{ marginTop: 0 }}>How the rules decided</h2>
            <div className="sim-steps">
              {result.steps.map((step, i) => (
                <div className={`sim-step ${step.outcome}`} key={i}>
                  <span className="sim-step-mark">
                    {step.outcome === "fired" ? "→" : step.outcome === "passed" ? "✓" : "·"}
                  </span>
                  <div>
                    <div className="sim-step-title">{step.title}</div>
                    <div className="sim-step-note">{step.note}</div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginBottom: 0 }}>
              → the rule that decided · ✓ checked and moved on · faint rows didn&apos;t apply
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
