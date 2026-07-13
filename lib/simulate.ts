// Client-side port of the engine's scoring + routing rules, so the simulator
// can walk a hypothetical lead through the exact same decision path live.
// Mirrors engine/scoring.py and engine/routing.py — if those change, this
// file changes with them.

import { Rep, snapshot } from "@/lib/snapshot";

export type SimInput = {
  employees: number;
  seniority: "executive" | "director" | "manager" | "individual";
  source: string;
  pagesViewed: number;
  trialStarted: boolean;
  daysSinceTouch: number;
  region: "West" | "Central" | "East" | "INTL";
  relationship:
    | "new"           // never seen this company
    | "customer"      // existing customer
    | "open_opp"      // active deal in progress
    | "owned_active"  // a rep owns it and worked it recently
    | "owned_stale";  // a rep owns it but hasn't touched it in 100+ days
};

const SOURCE_INTENT: Record<string, number> = {
  demo_request: 1.0,
  free_trial: 0.95,
  contact_sales: 0.9,
  pricing_page: 0.85,
  webinar: 0.55,
  outbound_sequence: 0.5,
  content_download: 0.35,
  newsletter: 0.2,
  cold_list: 0.15,
};

const SENIORITY_SCALE: Record<string, number> = {
  executive: 1.0,
  director: 0.9,
  manager: 0.6,
  individual: 0.3,
};

export function segmentFor(employees: number): string {
  if (employees <= 100) return "SMB";
  if (employees <= 1000) return "MidMarket";
  return "Enterprise";
}

export type SimScore = {
  total: number;
  band: "A" | "B" | "C" | "D";
  breakdown: Record<string, number>;
};

export function scoreLead(input: SimInput): SimScore {
  const breakdown: Record<string, number> = {
    source_intent: round1((SOURCE_INTENT[input.source] ?? 0.3) * 30),
    seniority: round1((SENIORITY_SCALE[input.seniority] ?? 0.4) * 20),
    firmographic: round1(Math.min(input.employees / 2000, 1) * 20),
    behavioral: round1(
      (Math.min(input.pagesViewed / 20, 1) * 0.6 + (input.trialStarted ? 0.4 : 0)) * 25
    ),
    recency: round1(Math.max(0, 1 - input.daysSinceTouch / 60) * 5),
  };
  const total = Math.max(
    0,
    Math.min(100, Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0)))
  );
  const band = total >= 75 ? "A" : total >= 50 ? "B" : total >= 30 ? "C" : "D";
  return { total, band, breakdown };
}

export type SimStep = {
  title: string;
  outcome: "fired" | "passed" | "skipped";
  note: string;
};

export type SimResult = {
  score: SimScore;
  segment: string;
  steps: SimStep[];
  finalStatus: "routed" | "nurture" | "unrouted";
  finalRep: Rep | null;
  finalHeadline: string;
  finalExplanation: string;
  nextStep: string;
  whyNot: string; // the near-miss: what would have changed this outcome
};

function eligibleReps(segment: string, region: string | null, seniorOnly: boolean): Rep[] {
  return snapshot.reps.filter(
    (r) =>
      r.segment === segment &&
      (region === null || r.region === region) &&
      (!seniorOnly || r.seniority === "senior") &&
      r.pool_load < r.capacity // owned-account leads don't count against capacity
  );
}

function leastLoaded(reps: Rep[]): Rep {
  return [...reps].sort((a, b) => a.pool_load / a.capacity - b.pool_load / b.capacity)[0];
}

// The single change that would add the most points, in plain English.
function biggestLever(input: SimInput, score: SimScore): { text: string; gain: number } {
  const levers: { text: string; gain: number }[] = [];
  if (!input.trialStarted) levers.push({ text: "starting a free trial", gain: 10 });
  if (input.pagesViewed < 20)
    levers.push({
      text: "more time on the site",
      gain: Math.round((1 - Math.min(input.pagesViewed / 20, 1)) * 0.6 * 25),
    });
  if (input.seniority !== "executive")
    levers.push({
      text: "a more senior contact reaching out",
      gain: Math.round(20 - (score.breakdown.seniority ?? 0)),
    });
  if (input.daysSinceTouch > 0)
    levers.push({ text: "fresher activity", gain: Math.round(5 - (score.breakdown.recency ?? 0)) });
  levers.sort((a, b) => b.gain - a.gain);
  return levers[0] ?? { text: "a stronger source, like a demo request", gain: 0 };
}

// What would have changed this outcome? Shown alongside every result so the
// reader learns where the thresholds are, not just where this lead landed.
function nearMiss(input: SimInput, score: SimScore, status: SimResult["finalStatus"]): string {
  if (
    input.relationship === "customer" ||
    input.relationship === "open_opp" ||
    input.relationship === "owned_active"
  ) {
    return "The score didn't matter here. Relationship rules run first, so even a Cold lead from this company would have gone to the same rep.";
  }
  if (status === "unrouted") {
    return "No lead detail would have changed this. It's a capacity problem: the fix is more room on the team, not a better lead.";
  }
  const lever = biggestLever(input, score);
  if (status === "nurture") {
    const need = 30 - score.total;
    return `${need} more point${need === 1 ? "" : "s"} would have sent it to a rep instead of the nurture list. Biggest lever: ${lever.text} (worth about ${lever.gain} points).`;
  }
  if (score.band === "A") {
    const margin = score.total - 75;
    return `It cleared the Hot threshold (75) by ${margin} point${margin === 1 ? "" : "s"}. A little less engagement and it would have gone into the normal rotation instead of the senior fast lane.`;
  }
  const toHot = 75 - score.total;
  const aboveNurture = score.total - 30;
  if (toHot <= 15) {
    return `${toHot} more point${toHot === 1 ? "" : "s"} would have made it Hot and skipped it to a senior rep. Biggest lever: ${lever.text} (worth about ${lever.gain} points).`;
  }
  return `It sat comfortably in the middle: ${toHot} points short of the senior fast lane (75), ${aboveNurture} points above the nurture cutoff (30). ${lever.text[0].toUpperCase() + lever.text.slice(1)} would move it most (about ${lever.gain} points).`;
}

export function simulate(input: SimInput): SimResult {
  const score = scoreLead(input);
  const segment = segmentFor(input.employees);
  const steps: SimStep[] = [];
  const owned = input.relationship !== "new";

  // Step 0: matching context.
  steps.push({
    title: "Do we already know this company?",
    outcome: owned ? "fired" : "passed",
    note: owned
      ? "Yes — it matched a company in the book of business."
      : "No match found, so this is treated as a brand-new company.",
  });

  const finish = (
    finalStatus: SimResult["finalStatus"],
    finalRep: Rep | null,
    finalHeadline: string,
    finalExplanation: string,
    nextStep: string
  ): SimResult => ({
    score,
    segment,
    steps,
    finalStatus,
    finalRep,
    finalHeadline,
    finalExplanation,
    nextStep,
    whyNot: nearMiss(input, score, finalStatus),
  });

  // Rule 1: existing customer.
  if (input.relationship === "customer") {
    steps.push({
      title: "Is it already a customer?",
      outcome: "fired",
      note: "Yes. The lead goes straight to the rep who owns the relationship. A current customer is never handed to a stranger.",
    });
    return finish(
      "routed",
      null,
      "Goes to the account's own rep",
      "This company is already a customer, so the new lead stays with the rep who manages that relationship.",
      "The account's rep should treat this as an expansion conversation and reply today."
    );
  }
  steps.push({
    title: "Is it already a customer?",
    outcome: owned ? "passed" : "skipped",
    note: owned ? "No, not a customer yet." : "Not applicable, we don't know this company.",
  });

  // Rule 2: open opportunity.
  if (input.relationship === "open_opp") {
    steps.push({
      title: "Is there a deal already in progress?",
      outcome: "fired",
      note: "Yes. The lead goes to the rep working that deal, so nobody steps on an active negotiation.",
    });
    return finish(
      "routed",
      null,
      "Goes to the rep working the deal",
      "There's already an active deal with this company, so the new lead joins it rather than starting a competing thread.",
      "The deal's rep should fold this new contact into the ongoing conversation."
    );
  }
  steps.push({
    title: "Is there a deal already in progress?",
    outcome: owned ? "passed" : "skipped",
    note: owned ? "No active deal." : "Not applicable.",
  });

  // Rule 3: recent ownership.
  if (input.relationship === "owned_active") {
    steps.push({
      title: "Has the owning rep worked it in the last 90 days?",
      outcome: "fired",
      note: "Yes. Ownership is still fresh, so the lead stays with the same rep for continuity.",
    });
    return finish(
      "routed",
      null,
      "Stays with the current owner",
      "The owning rep touched this account within the 90-day ownership window, so the relationship stays intact.",
      "The owning rep should follow up while the earlier conversation is still warm."
    );
  }
  if (input.relationship === "owned_stale") {
    steps.push({
      title: "Has the owning rep worked it in the last 90 days?",
      outcome: "passed",
      note: "No — the account sat untouched past the 90-day window, so ownership resets and the lead returns to the shared pool.",
    });
  } else {
    steps.push({
      title: "Has the owning rep worked it in the last 90 days?",
      outcome: owned ? "passed" : "skipped",
      note: owned ? "Ownership is stale." : "Not applicable.",
    });
  }

  // Rule 4: score gate.
  if (score.band === "D") {
    steps.push({
      title: "Is the score high enough to send to a rep?",
      outcome: "fired",
      note: `No — it scored ${score.total} out of 100 (Cold). Sending cold leads to reps wastes their day, so it goes to automated follow-up instead.`,
    });
    return finish(
      "nurture",
      null,
      "Goes to the nurture list",
      `With a score of ${score.total} out of 100, this lead isn't ready for a salesperson. It will get automated emails, and comes back if it warms up.`,
      "No rep action needed. Revisit if the contact re-engages, e.g. returns to the pricing page."
    );
  }
  steps.push({
    title: "Is the score high enough to send to a rep?",
    outcome: "passed",
    note: `Yes — ${score.total} out of 100.`,
  });

  // Rule 5: senior preference for hot leads.
  const preferSenior = score.band === "A";
  const region = input.region;
  if (preferSenior) {
    const seniors = eligibleReps(segment, region, true);
    if (seniors.length) {
      const rep = leastLoaded(seniors);
      steps.push({
        title: "It's a hot lead — is a senior rep available?",
        outcome: "fired",
        note: `Yes. Hot leads convert best with an experienced rep, so it goes to ${rep.name}.`,
      });
      return finish(
        "routed",
        rep,
        `Assigned to ${rep.name} (senior rep)`,
        `Scored ${score.total} out of 100 — a hot lead — so it skips the normal rotation and goes to a senior ${segment} rep in the ${region} region.`,
        `${rep.name} should call within 5 minutes. Hot leads cool off fast.`
      );
    }
    steps.push({
      title: "It's a hot lead — is a senior rep available?",
      outcome: "passed",
      note: "No senior rep has room right now, so it falls back to the normal rotation.",
    });
  } else {
    steps.push({
      title: "It's a hot lead — is a senior rep available?",
      outcome: "skipped",
      note: "Not applicable, only Hot (75+) leads get the senior fast lane.",
    });
  }

  // Rule 6: fair rotation in home region.
  const home = eligibleReps(segment, region, false);
  if (home.length) {
    const rep = leastLoaded(home);
    steps.push({
      title: "Share it fairly within the home team",
      outcome: "fired",
      note: `${rep.name} currently has the lightest workload on the ${segment} ${region} team, so the lead goes to them.`,
    });
    return finish(
      "routed",
      rep,
      `Assigned to ${rep.name}`,
      `A new ${segment} lead in the ${region} region, scored ${score.total} out of 100. Assigned to whoever has the most room, to keep workloads fair.`,
      score.band === "B"
        ? `${rep.name} should follow up today while interest is fresh.`
        : `${rep.name} can work this in their normal rotation.`
    );
  }
  steps.push({
    title: "Share it fairly within the home team",
    outcome: "passed",
    note: `Every ${segment} rep in ${region} is at their lead limit.`,
  });

  // Rule 7: overflow to another region.
  const anyRegion = eligibleReps(segment, null, false);
  if (anyRegion.length) {
    const rep = leastLoaded(anyRegion);
    steps.push({
      title: "Home team full — can another region take it?",
      outcome: "fired",
      note: `Yes. Rather than let a live lead sit, it goes to ${rep.name} on the ${rep.region} team.`,
    });
    return finish(
      "routed",
      rep,
      `Assigned to ${rep.name} (${rep.region} team)`,
      `The ${region} team was full, so the lead overflowed to the ${rep.region} team instead of waiting.`,
      `${rep.name} should respond normally, and the routing owner should watch whether ${region} needs more capacity.`
    );
  }
  steps.push({
    title: "Home team full — can another region take it?",
    outcome: "passed",
    note: `Every ${segment} rep everywhere is at their limit.`,
  });

  return finish(
    "unrouted",
    null,
    "Stuck — no rep available",
    `Every ${segment} rep is at their lead limit, so this lead would sit in a holding queue until someone frees up or a manager steps in.`,
    "A manager should assign this by hand today, and consider raising the team's lead limits or hiring."
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;
