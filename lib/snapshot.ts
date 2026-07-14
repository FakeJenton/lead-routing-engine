import raw from "@/public/data/routing_snapshot.json";

export type Summary = {
  total: number;
  routed: number;
  nurture: number;
  unrouted: number;
  matched: number;
  match_rate: number;
  override_rate: number;
  sla_minutes: number;
  sla_breaches: number;
  speed_p50: number;
  speed_p90: number;
  speed_p99: number;
  num_reps: number;
  num_accounts: number;
  resting_period_days: number;
};

export type Rep = {
  rep_id: string;
  name: string;
  segment: string;
  region: string;
  seniority: string;
  is_ramping: boolean;
  capacity: number;
  load: number;      // everything the rep received, including owned accounts
  pool_load: number; // only shared-pool leads — what counts against capacity
};

export type Decision = {
  lead_id: string;
  company: string;
  segment: string;
  region: string;
  score: number;
  band: string;
  score_breakdown: Record<string, number>;
  match_method: string;
  match_confidence: number;
  matched_account_id: string | null;
  rule_fired: string;
  assigned_rep_id: string | null;
  status: "routed" | "nurture" | "unrouted";
  reason: string;
  time_in_queue_min: number | null;
  source: string;
  seniority: string;
  job_title: string;
  industry: string;
  employee_count: number;
  state: string;
  is_personal_email: boolean;
  pages_viewed: number;
  trial_started: boolean;
  days_since_touch: number;
  manual_override: boolean;
};

// The lead subset an alert is talking about. Clicking the alert applies this
// to the audit table so the reader lands on exactly those leads.
export type AlertFilter = {
  statuses?: string[];
  rules?: string[];
  min_wait_min?: number;
  band?: string;
  match?: string;
  overridden?: boolean;
  q?: string;
};

export type Alert = {
  level: "critical" | "warning" | "info";
  text: string;
  action: string;
  chip: string; // short label shown while the filter is active
  filter: AlertFilter;
};

export type Snapshot = {
  summary: Summary;
  generated_at: string;
  match_methods: { method: string; count: number }[];
  rules: { rule: string; count: number }[];
  score_bands: { band: string; count: number }[];
  reps: Rep[];
  alerts: Alert[];
  decisions: Decision[];
};

export const snapshot = raw as Snapshot;

export const pct = (n: number) => `${Math.round(n * 100)}%`;

// Plain-English labels for the machine rule_fired keys.
export const RULE_LABELS: Record<string, string> = {
  existing_customer_expansion: "Already a customer → their rep",
  open_opportunity: "Deal in progress → deal's rep",
  active_ownership: "Recently worked → same rep",
  nurture_low_score: "Low score → nurture list",
  pool_round_robin_in_queue: "Shared fairly across team",
  pool_senior_preferred_in_queue: "Hot lead → senior rep",
  pool_region_overflow: "Home team full → other region",
  unrouted_no_capacity: "Stuck — no rep available",
};

export const METHOD_LABELS: Record<string, string> = {
  domain: "Company email",
  name_exact: "Exact name",
  name_fuzzy: "Similar name",
  none: "New company",
};

export const STATUS_LABELS: Record<string, string> = {
  routed: "Routed",
  nurture: "Nurture",
  unrouted: "Stuck",
};

// Temperature words for score bands — friendlier than "band B".
export const BAND_WORDS: Record<string, string> = {
  A: "Hot",
  B: "Warm",
  C: "Cool",
  D: "Cold",
};

export const ruleLabel = (k: string) => RULE_LABELS[k] ?? k;
export const methodLabel = (k: string) => METHOD_LABELS[k] ?? k;
export const statusLabel = (k: string) => STATUS_LABELS[k] ?? k;
export const bandWord = (b: string) => BAND_WORDS[b] ?? b;

// Rep id -> display name, so "R04" never reaches the reader.
const repNames: Record<string, string> = Object.fromEntries(
  snapshot.reps.map((r) => [r.rep_id, r.name])
);
export const repName = (id: string | null) => (id ? repNames[id] ?? id : null);

// "0.4m" is engineer-speak; say "24 sec" or "1.9 min".
export const fmtMinutes = (m: number | null | undefined) => {
  if (m == null) return "—";
  if (m < 1) return `${Math.round(m * 60)} sec`;
  return `${Math.round(m * 10) / 10} min`;
};

// One vocabulary for the five scoring signals, used identically on the
// dashboard, the simulator, and the How-it-works page: plain name first,
// the technical term in parentheses. Max points mirror SCORE_WEIGHTS in
// engine/config.py.
export const SIGNALS: { key: string; label: string; tech: string; max: number }[] = [
  { key: "source_intent", label: "How they found us", tech: "source intent", max: 30 },
  { key: "behavioral", label: "Product engagement", tech: "behavioral", max: 25 },
  { key: "seniority", label: "Contact's role", tech: "seniority", max: 20 },
  { key: "firmographic", label: "Company size", tech: "firmographic", max: 20 },
  { key: "recency", label: "How recent", tech: "recency", max: 5 },
];

// Friendly names for lead sources, shared by the audit trail and simulator.
export const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "demo_request", label: "Asked for a demo" },
  { value: "free_trial", label: "Started a free trial" },
  { value: "contact_sales", label: "Clicked “Contact sales”" },
  { value: "pricing_page", label: "Viewed the pricing page" },
  { value: "webinar", label: "Attended a webinar" },
  { value: "outbound_sequence", label: "Replied to our outreach" },
  { value: "content_download", label: "Downloaded a guide" },
  { value: "newsletter", label: "Signed up for the newsletter" },
  { value: "cold_list", label: "Came from a purchased list" },
];
const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  SOURCE_OPTIONS.map((o) => [o.value, o.label])
);
export const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s.replace(/_/g, " ");

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// The actual logged value behind each scoring signal, e.g.
// "Contact's role (seniority): Executive".
export const signalValue = (d: Decision, key: string): string => {
  switch (key) {
    case "source_intent":
      return sourceLabel(d.source);
    case "seniority":
      return cap(d.seniority);
    case "firmographic":
      return d.employee_count != null
        ? `${d.employee_count.toLocaleString()} employees`
        : "size unknown";
    case "behavioral": {
      const pages = `${d.pages_viewed ?? 0} page${d.pages_viewed === 1 ? "" : "s"} viewed`;
      return d.trial_started ? `${pages} · started a trial` : pages;
    }
    case "recency":
      if (d.days_since_touch === 0) return "Active today";
      if (d.days_since_touch === 1) return "Active yesterday";
      return `Last active ${d.days_since_touch} days ago`;
    default:
      return "";
  }
};

// Every lead gets a recommended next step — a decision without an action is
// just trivia.
export const nextStep = (d: Decision): string => {
  const rep = repName(d.assigned_rep_id) ?? "the assigned rep";
  if (d.status === "unrouted")
    return `Assign this lead by hand today — no ${d.segment} rep had room. If this keeps happening, raise that team's lead limits or add a rep.`;
  if (d.status === "nurture")
    return "No rep action needed. Leave it in automated follow-up, and revisit if the contact re-engages.";
  if (d.rule_fired === "existing_customer_expansion")
    return `${rep} already owns this relationship — reply today and treat it as an expansion conversation.`;
  if (d.rule_fired === "open_opportunity")
    return `${rep} should fold this new contact into the deal already in progress.`;
  if (d.band === "A")
    return `${rep} should reach out right now — hot leads convert best in the first few minutes.`;
  if (d.band === "B") return `${rep} should follow up today while interest is fresh.`;
  return `${rep} can work this in their normal rotation.`;
};
