import { snapshot } from "@/lib/snapshot";

export const metadata = { title: "Methodology · Lead Routing Engine" };

const rest = snapshot.summary.resting_period_days;

function Node({ n, q, a }: { n?: string; q: string; a: React.ReactNode }) {
  return (
    <>
      <div className="node">
        <div className="q">
          {n && <span className="num">{n}</span>}
          {q}
        </div>
        <div className="a">{a}</div>
      </div>
      <div className="connector" />
    </>
  );
}

export default function Methodology() {
  return (
    <div className="prose">
      <div className="page-head">
        <h1>Methodology</h1>
        <p>
          How leads are scored, matched, and routed. This is the institutional
          reference a routing owner maintains, so a new analyst can understand and
          safely change the system. The same content ships as{" "}
          <code>docs/routing_logic.md</code> in the repo.
        </p>
      </div>

      <h2>The routing decision tree</h2>
      <p>
        Rules are evaluated top to bottom. The first that fires wins. Each rule is
        a guardrail against the ones beneath it: never round-robin a current
        customer to a stranger, never take an active deal from the rep working it.
      </p>
      <div className="flow">
        <Node
          q="Match the lead to a known account"
          a="Corporate domain → exact normalized name → state-gated fuzzy name. Personal email domains are skipped for domain matching."
        />
        <Node
          n="1"
          q="Matched an existing customer?"
          a={<>Route to the <b>account owner</b> for expansion.</>}
        />
        <Node
          n="2"
          q="Matched an account with an open opportunity?"
          a={<>Route to the <b>deal owner</b> already working it.</>}
        />
        <Node
          n="3"
          q={`Owner touched the account within ${rest} days?`}
          a={<>Keep it with the <b>current owner</b> (continuity).</>}
        />
        <Node
          n="4"
          q={`Owner inactive beyond ${rest} days?`}
          a="Ownership is stale. Reset it and return the lead to the pool."
        />
        <Node
          n="5"
          q="Net-new or reset: what does the score say?"
          a={
            <>
              Band D → <b>nurture</b> (no rep). Band A → <b>senior rep</b> in
              queue. Band B/C → <b>round-robin</b> in queue.
            </>
          }
        />
        <Node
          n="6"
          q="Queue exhausted?"
          a="Overflow to the same segment in another region, else mark unrouted and escalate."
        />
      </div>

      <h2>Matching tiers</h2>
      <p>
        Matching is the hardest part of routing. A missed match creates a
        duplicate account and misroutes an expansion lead; a false match hands a
        lead to the wrong rep. The matcher is deliberately conservative on fuzzy
        matches and gates them by geography.
      </p>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Method</th>
            <th>Confidence</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
            <td>Exact corporate domain</td>
            <td>1.00</td>
            <td>Skipped for personal email (gmail, yahoo), which carry no account signal.</td>
          </tr>
          <tr>
            <td>2</td>
            <td>Exact normalized name</td>
            <td>0.95</td>
            <td>&ldquo;Acme Labs, Inc.&rdquo; and &ldquo;acme labs&rdquo; both normalize to &ldquo;acme labs&rdquo;.</td>
          </tr>
          <tr>
            <td>3</td>
            <td>Fuzzy normalized name</td>
            <td>0.88 – 0.96</td>
            <td>Accepted only when state agrees, or similarity is near-perfect. Suppresses false positives from common names.</td>
          </tr>
        </tbody>
      </table>

      <h2>Signal dictionary (lead scoring)</h2>
      <p>
        A transparent 0 – 100 score from five weighted signal groups. Rules-based
        on purpose for v1: every point is explainable to a VP and auditable per
        lead. The router only depends on the score interface, so a statistical
        model can replace it later without touching routing.
      </p>
      <table>
        <thead>
          <tr>
            <th>Signal group</th>
            <th>Weight</th>
            <th>Inputs</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Source intent</td><td>30</td><td>Lead source (demo request &gt; pricing view &gt; newsletter)</td></tr>
          <tr><td>Seniority</td><td>20</td><td>Executive &gt; director &gt; manager &gt; individual</td></tr>
          <tr><td>Firmographic</td><td>20</td><td>Employee count</td></tr>
          <tr><td>Behavioral</td><td>25</td><td>Pages viewed, trial started</td></tr>
          <tr><td>Recency</td><td>5</td><td>Days since last engagement</td></tr>
        </tbody>
      </table>
      <p>
        Bands: <code>A</code> 75+, <code>B</code> 50 – 74, <code>C</code> 30 – 49,{" "}
        <code>D</code> below 30.
      </p>

      <h2>Guardrails and monitoring</h2>
      <p>
        The monitor reads the audit log each run and alerts on breaches. In
        production the alert POSTs to a Slack webhook; in the demo the payload is
        printed and surfaced on the dashboard.
      </p>
      <table>
        <thead>
          <tr>
            <th>Guardrail</th>
            <th>Fires when</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Distribution skew</td>
            <td>A rep exceeds 1.5× fair share of native round-robin in a queue (thin queues excluded).</td>
          </tr>
          <tr>
            <td>Speed-to-lead SLA</td>
            <td>Assignments exceed the {snapshot.summary.sla_minutes}-minute SLA at a high rate.</td>
          </tr>
          <tr>
            <td>Unrouted escalation</td>
            <td>Any lead is left unrouted because all reps are at capacity.</td>
          </tr>
          <tr>
            <td>Override rate</td>
            <td>Manual re-route rate is high enough to suggest the rules are wrong.</td>
          </tr>
          <tr>
            <td>Match rate floor</td>
            <td>Match rate drops low enough to suggest matching is failing.</td>
          </tr>
        </tbody>
      </table>

      <h2>What is real vs simulated</h2>
      <p>
        The scoring, matching, rule graph, assignment, and guardrails are the real
        logic. The data is synthetic and seeded (reproducible), and speed-to-lead
        timestamps are simulated as a stand-in until wired to live lead-created
        and first-touch events. The roadmap swaps the rules-based score for a
        statistical model and adds connect-rate and closed-loss diagnostics.
      </p>
    </div>
  );
}
