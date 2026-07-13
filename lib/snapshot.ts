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
  load: number;
};

export type Decision = {
  lead_id: string;
  company: string;
  segment: string;
  region: string;
  score: number;
  band: string;
  match_method: string;
  matched_account_id: string | null;
  rule_fired: string;
  assigned_rep_id: string | null;
  status: "routed" | "nurture" | "unrouted";
  reason: string;
  time_in_queue_min: number | null;
  source: string;
  seniority: string;
  num_locations: number;
  state: string;
  is_personal_email: boolean;
};

export type Snapshot = {
  summary: Summary;
  match_methods: { method: string; count: number }[];
  rules: { rule: string; count: number }[];
  score_bands: { band: string; count: number }[];
  reps: Rep[];
  alerts: { level: "critical" | "warning"; text: string }[];
  decisions: Decision[];
};

export const snapshot = raw as Snapshot;

export const pct = (n: number) => `${Math.round(n * 100)}%`;

// Human-friendly labels for the machine rule_fired keys.
export const RULE_LABELS: Record<string, string> = {
  existing_customer_expansion: "Existing customer (expansion)",
  open_opportunity: "Open opportunity",
  active_ownership: "Active ownership (within resting period)",
  nurture_low_score: "Nurture (low score)",
  pool_round_robin_in_queue: "Round-robin in queue",
  pool_senior_preferred_in_queue: "Senior-preferred (A-band)",
  pool_region_overflow: "Region overflow",
  unrouted_no_capacity: "Unrouted (no capacity)",
};

export const METHOD_LABELS: Record<string, string> = {
  domain: "Corporate domain",
  name_exact: "Exact name",
  name_fuzzy: "Fuzzy name",
  none: "No match (net-new)",
};

export const ruleLabel = (k: string) => RULE_LABELS[k] ?? k;
export const methodLabel = (k: string) => METHOD_LABELS[k] ?? k;
