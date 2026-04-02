# NOOTERRA

### The most advanced AI agent infrastructure for business.

---

## What Aiden Built

Every AI company right now is doing the same thing: take a language model, give it some tools, let it do stuff. ChatGPT answers questions. Copilot writes code. Jasper writes marketing copy.

**None of them can actually run a business.**

They can't because they don't *understand* a business. They don't know who your customers are, what they owe you, what they said in their last email, whether they're about to churn, or what happens if you follow up today vs. next week. They process one request at a time with no memory, no model, no governance.

Aiden is building the layer that's missing: **a system that maintains a live, predictive model of a company and deploys AI agents that operate within it.**

Not chatbots. Not automations. Governed agents backed by a world model — the most technically advanced approach to AI business operations that exists.

---

## How It Works (The Full Technical Picture)

The system is a continuous loop. Seven stages, running constantly:

```
    ┌──────────────────────────────────────────────────────────────┐
    │                                                              │
    │   ┌───────────┐     ┌───────────┐     ┌───────────────┐    │
    │   │           │     │           │     │               │    │
    │   │  OBSERVE  │────▶│   MODEL   │────▶│   PREDICT     │    │
    │   │           │     │           │     │               │    │
    │   │ Watches   │     │ Builds a  │     │ Estimates     │    │
    │   │ Stripe,   │     │ live map  │     │ hidden state: │    │
    │   │ Gmail,    │     │ of every  │     │               │    │
    │   │ QuickBooks│     │ customer, │     │ "72% chance   │    │
    │   │ Calendar  │     │ invoice,  │     │  this gets    │    │
    │   │ in real   │     │ payment,  │     │  paid in      │    │
    │   │ time      │     │ & convo   │     │  7 days"      │    │
    │   │           │     │           │     │               │    │
    │   └───────────┘     └───────────┘     └───────┬───────┘    │
    │                                               │            │
    │   ┌───────────┐     ┌───────────┐     ┌───────▼───────┐    │
    │   │           │     │           │     │               │    │
    │   │   LEARN   │◀────│ EVALUATE  │◀────│     ACT       │    │
    │   │           │     │           │     │               │    │
    │   │ Model     │     │ Every     │     │ Agent sends   │    │
    │   │ gets more │     │ action is │     │ the right     │    │
    │   │ accurate. │     │ graded:   │     │ email, to the │    │
    │   │ Agent     │     │           │     │ right person, │    │
    │   │ earns     │     │ Process?  │     │ at the right  │    │
    │   │ more      │     │ Outcome?  │     │ time — with   │    │
    │   │ autonomy. │     │           │     │ full evidence │    │
    │   │           │     │           │     │ of WHY.       │    │
    │   └───────────┘     └───────────┘     └───────────────┘    │
    │                                                              │
    │              Every pass makes it smarter.                    │
    └──────────────────────────────────────────────────────────────┘
```

---

## What Makes This Different From Everything Else

The AI landscape right now looks like this:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   CHATBOTS                    AUTOMATION                            │
│   (ChatGPT, Claude)           (Zapier, Make)                        │
│                                                                     │
│   ● Answers questions         ● If-then rules                      │
│   ● No memory of you          ● No intelligence                    │
│   ● Can't take real actions   ● Breaks on exceptions               │
│   ● No governance             ● No prediction                      │
│   ● Forgets after each chat   ● No learning                        │
│                                                                     │
│   VERTICAL AI                 AGENT FRAMEWORKS                      │
│   (Harvey, Abridge)           (LangChain, CrewAI)                   │
│                                                                     │
│   ● One domain only           ● Developer tools                    │
│   ● Can't cross systems       ● No world model                     │
│   ● Deep but narrow           ● No governance                      │
│                                ● You build everything               │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   NOOTERRA                                                          │
│                                                                     │
│   ✓ Connects ALL your systems (Stripe, Gmail, QuickBooks, etc.)    │
│   ✓ Builds a WORLD MODEL — a live, predictive map of the business  │
│   ✓ Deploys GOVERNED AGENTS that act within your policies          │
│   ✓ Every action has an EVIDENCE BUNDLE (auditable, traceable)     │
│   ✓ Agents EARN TRUST from demonstrated performance               │
│   ✓ A META-AGENT manages other agents (AI managing AI)             │
│   ✓ The system LEARNS from every outcome                          │
│   ✓ 12-layer architecture — deepest technical stack in the space   │
│                                                                     │
│   Nobody else has the world model + governance + learning loop      │
│   running together. That's the invention.                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## The World Model — Why This Is The Key Breakthrough

Most AI agents are blind. They get a prompt, call some tools, and return a result. They have no understanding of the business they're operating in.

**Nooterra's agents have a world model.** Here's the difference:

```
STANDARD AI AGENT                        NOOTERRA AGENT
                                         (with world model)

Input: "Follow up on                     Input: "Follow up on
overdue invoices"                        overdue invoices"
                                         
What it knows:                           What it knows:
● Nothing                                ● Invoice #1247: $4,200, 18 days overdue
                                         ● Customer: Acme Corp
What it does:                            │  ├── Payment history: 9/10 on time
● Sends a generic template               │  ├── Last email: mentioned "cash flow"
  to everyone                            │  ├── Churn risk: 12%
                                         │  └── Lifetime value: $87,000
What happens:                            ● 3 related email threads
● Maybe it works                         ● Last contact: 5 days ago
● Maybe it annoys customers              ● Payment probability: 72% if contacted now
● No one knows why                       │                      40% if we wait a week
● No audit trail                         ● Dispute risk: 8%
                                         
                                         What it does:
                                         ● Sends a PERSONALIZED email
                                         ● References their cash flow situation
                                         ● Empathetic tone (long-time customer)
                                         ● Includes direct payment link
                                         ● Evidence bundle: exactly WHY this action
                                         
                                         What happens:
                                         ● 72% → 85% payment probability
                                         ● Outcome tracked automatically
                                         ● Model updates when they pay
                                         ● Agent gets smarter for next time
```

The world model is what makes agents actually intelligent instead of just automated.

---

## The Architecture — 12 Layers Deep

This is the most technically sophisticated agent system being built:

```
Layer 0   OBSERVATION PLANE         Watches Stripe, Gmail, QuickBooks,
          ─────────────────         Calendar, CRM in real time. Every
                │                   signal becomes a typed event.
                ▼
Layer 1   EVENT LEDGER              Append-only, tamper-proof log of
          ────────────              everything. Hash-chained like a
                │                   blockchain. Full audit trail.
                ▼
Layer 2   OBJECT GRAPH              Live map of every business entity.
          ────────────              Customers, invoices, payments,
                │                   conversations — all linked.
                ▼
Layer 3   STATE ESTIMATOR           Infers HIDDEN state. Things no
          ───────────────           single system reports: churn risk,
                │                   payment probability, urgency.
                ▼
Layer 4   WORLD MODEL               Predicts consequences of actions
          ───────────               BEFORE taking them. Rules +
                │                   statistics + causal inference.
                ▼
Layer 5   POLICY ENGINE             Your rules, compiled into code.
          ─────────────             Written in English, enforced as
                │                   deterministic guards. Not prompts.
                ▼
Layer 6   PLANNER                   Decides what to do, in what order,
          ───────                   with what priority. Reactive +
                │                   proactive planning.
                ▼
Layer 7   AGENT RUNTIME             Thin execution loops. The agents
          ─────────────             themselves. They're just hands —
                │                   the brain is the world model.
                ▼
Layer 8   ACTION GATEWAY            11-step security pipeline before
          ──────────────            ANY action touches the real world.
                │                   Authenticate → Authorize → Validate
                │                   → Rate limit → Budget → Disclosure
                │                   → Simulate → Escrow → Execute
                │                   → Audit → Notify
                ▼
Layer 9   EVALUATION ENGINE         Grades every action on TWO scores:
          ─────────────────         Did it follow the right process?
                │                   Did it achieve the goal?
                ▼
Layer 10  GOVERNANCE COCKPIT        Human interface. Live company view,
          ──────────────────        predictions, autonomy map, policy
                │                   editor, approval queue.
                ▼
Layer 11  INTER-COMPANY NETWORK     Agents across companies discover
          ─────────────────────     and negotiate with each other.
                                    The network effect.
```

For context: most AI agent startups have 2-3 of these layers. Nooterra has all 12, integrated into one closed loop.

---

## How Trust Is Earned (The Innovation Nobody Else Has)

Every other AI product says "trust us." Nooterra says "watch us prove it."

```
WEEK 1                    WEEK 3                    WEEK 5+
──────                    ──────                    ──────

SHADOW MODE               SUPERVISED                AUTONOMOUS
                                                    
Agent proposes            Agent acts with           Proven actions run
actions but               your one-click            automatically.
DOESN'T execute.          approval.                 
                                                    Still logged.
You review every          System tracks:            Still governed.
proposal.                 38/40 approved.           Still auditable.
                          0 incidents.              
"I would send this        94% quality score.        ONE mistake →
 email to Acme Corp                                 immediate demotion.
 about Invoice #1247..."  
                          ┌─────────────────────┐   
You: looks good. ✓        │ PROMOTION PROPOSAL  │   Trust is not a 
You: tweak this one. ✏️    │                     │   setting you flip.
You: no, wrong tone. ✗    │ 50 executions       │   It's a track record
                          │ 94% procedural      │   built over weeks.
                          │ 87% outcomes         │   
                          │ 0 incidents          │   Evidence, not faith.
                          │                     │
                          │ Recommend: promote  │
                          │ to autonomous for   │
                          │ emails < $5K to     │
                          │ known customers.    │
                          │                     │
                          │ [You approve] ✓     │
                          └─────────────────────┘
```

---

## The Business (Why This Makes Money)

**The market:** Every business runs operations — collections, support, scheduling, vendor management. Most of this is repetitive, pattern-based work. The global BPO market (paying humans to do this) is $300+ billion.

**The product:** Nooterra replaces that operational work with AI agents backed by a world model. Starting with AR collections (invoice follow-up, payment reminders).

**The pricing:**
```
Starter     $149/mo    See your business as a live model. 1 agent.
Business    $499/mo    Full agent autonomy. Predictions. Policies.
Enterprise  Custom     Unlimited. Simulator. SSO. SLA.

Unit economics: ~$50/mo LLM cost per customer → 83% gross margin at $499
```

**The moat — it compounds:**
```
MORE DATA ──▶ BETTER PREDICTIONS ──▶ BETTER AGENT DECISIONS
   ▲                                          │
   │                                          │
   └──── BETTER OUTCOMES ◀── MORE CUSTOMERS ◀─┘
   
   + The world model is institutional knowledge
   + Switching means losing your trained model
   + Cross-customer patterns improve everyone
   + Network effects when companies transact agent-to-agent
```

---

## What's Built Right Now

```
BACKEND
───────
37 modules across 12 architectural layers
├── Event ledger (append-only, hash-chained)
├── Object graph (typed, versioned, relationship-rich)
├── Stripe connector (webhooks → events + objects)
├── State estimator (payment probability, churn, dispute risk)
├── World model (rules + statistics + calibration tracking)
├── Authority engine (Zanzibar-style, attenuation-only)
├── Action gateway (11-step pipeline)
├── Agent runtime (3-layer context assembly)
├── Collections agent (first domain vertical)
├── Evaluation engine (procedural + outcome grading)
├── Autonomy coverage map (trust from evidence)
├── Self-optimization engine (meta-agent + model routing)
├── Forkable companies (snapshot + fork + templates)
└── Inter-company network (identity, discovery, negotiation)

FRONTEND
────────
8 views, fully designed
├── Landing page (editorial design, interactive trace demo)
├── Command center (health indicators, activity stream)
├── Company state (object graph explorer)
├── Prediction dashboard (cash flow, per-invoice probabilities)
├── Autonomy map (agent × action class trust grid)
├── Policy editor (natural language → compiled guards)
├── Approval queue (escrowed actions with evidence bundles)
└── Onboarding (connect Stripe + Gmail → launch agent)

DATABASE
────────
4 new migrations on top of 59 existing
├── world_events (append-only event ledger)
├── world_objects (canonical object graph)
├── authority_grants_v2 (Zanzibar-style DAG)
└── gateway_actions (every action with evidence)

INFRASTRUCTURE
──────────────
Railway deployment configured:
├── PostgreSQL database ✓
├── Composio API (250+ app integrations) ✓
├── OpenRouter API (LLM access) ✓
├── Stripe API (live key) ✓
├── Gmail OAuth configured ✓
└── 253 tests passing, 0 failures ✓
```

---

## The Vision — Where This Goes

```
NOW         First customers use Nooterra for AR collections.
            AI agents follow up on overdue invoices. Governed. Traced.

YEAR 1      Expand to support, scheduling, vendor management.
            One founder runs an operation that used to need 5 people.

YEAR 2      World model is accurate enough for predictive operations.
            "What happens if we change our collections cadence?"
            Run the simulation. See the projected outcome. Deploy.

YEAR 3      Companies on Nooterra transact with each other.
            Buyer agents negotiate with vendor agents.
            Both governed. Both audited. Agent-to-agent commerce.

YEAR 5      Any founder can deploy a fully governed, continuously
            improving business operation from a description of what
            they want to build. The executable company.
```

---

## Why This Matters

The transition happening right now is the same one that happened to every other industry:

```
MEDIA:        Printing presses → Websites
COMMERCE:     Stores → E-commerce  
FINANCE:      Bank tellers → APIs (Stripe)
INFRASTRUCTURE: Server rooms → Cloud (AWS)

BUSINESS OPERATIONS: Manual work → ???

That ??? is what Nooterra fills.
```

Every company will need this. Aiden is building it first.

---

*Nooterra Labs — the most advanced AI agent infrastructure for business.*
