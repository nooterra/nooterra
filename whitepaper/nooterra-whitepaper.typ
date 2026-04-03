// ============================================================
// NOOTERRA WHITEPAPER — Typst source
// Monochrome, investor-first, 12-14 pages
// ============================================================

#set document(
  title: "Nooterra: Enterprise World Model Platform",
  author: "Nooterra, Inc.",
  date: datetime(year: 2026, month: 4, day: 1),
)

#set page(
  paper: "us-letter",
  margin: (top: 1.2in, bottom: 1in, left: 1.1in, right: 1.1in),
  header: context {
    if counter(page).get().first() > 1 [
      #set text(8pt, fill: luma(140))
      NOOTERRA #h(1fr) Enterprise World Model Platform
      #v(-4pt)
      #line(length: 100%, stroke: 0.4pt + luma(200))
    ]
  },
  footer: context {
    if counter(page).get().first() > 1 [
      #line(length: 100%, stroke: 0.4pt + luma(200))
      #v(2pt)
      #set text(8pt, fill: luma(140))
      Confidential #h(1fr) Page #counter(page).display() #h(1fr) nooterra.ai
    ]
  },
)

#set text(
  font: "Helvetica Neue",
  size: 10.5pt,
  fill: luma(30),
)

#set par(
  leading: 0.72em,
  justify: true,
)

#set heading(numbering: "1.")

#show heading.where(level: 1): it => {
  v(1.2em)
  text(16pt, weight: "bold", it)
  v(0.4em)
}

#show heading.where(level: 2): it => {
  v(0.8em)
  text(12pt, weight: "bold", it)
  v(0.3em)
}

#show heading.where(level: 3): it => {
  v(0.6em)
  text(10.5pt, weight: "bold", it)
  v(0.2em)
}

// Utility: status badge
#let badge(label, dark: false) = {
  box(
    fill: if dark { luma(30) } else { luma(240) },
    radius: 3pt,
    inset: (x: 8pt, y: 3pt),
    text(
      8pt,
      weight: "bold",
      fill: if dark { white } else { luma(60) },
      upper(label),
    ),
  )
}

// Utility: callout box
#let callout(body) = {
  block(
    width: 100%,
    fill: luma(248),
    stroke: (left: 3pt + luma(60)),
    inset: 14pt,
    radius: (right: 4pt),
    body,
  )
}

// Utility: diagram box
#let diagram-box(title, body) = {
  block(
    width: 100%,
    stroke: 0.6pt + luma(180),
    radius: 4pt,
    clip: true,
  )[
    #block(
      width: 100%,
      fill: luma(245),
      inset: (x: 14pt, y: 8pt),
    )[
      #text(9pt, weight: "bold", fill: luma(80), upper(title))
    ]
    #block(
      width: 100%,
      inset: 14pt,
      body,
    )
  ]
}

// ============================================================
// COVER PAGE
// ============================================================

#page(header: none, footer: none)[
  #v(2.5in)

  #text(11pt, weight: "bold", tracking: 4pt, fill: luma(100))[NOOTERRA]

  #v(0.3in)

  #text(28pt, weight: "bold")[Enterprise World Model Platform]

  #v(0.2in)

  #text(12pt, fill: luma(80))[
    Why AI agents fail in enterprise systems, \
    and how governed dynamics modeling solves it.
  ]

  #v(1.5in)

  #text(10pt, fill: luma(120))[
    April 2026 \
    Confidential. For qualified partners and investors.
  ]

  #v(1fr)

  #line(length: 100%, stroke: 0.4pt + luma(200))
  #v(4pt)
  #text(8.5pt, fill: luma(140))[
    nooterra.ai
  ]
]

// ============================================================
// TABLE OF CONTENTS
// ============================================================

#page(header: none, footer: none)[
  #v(0.5in)
  #text(18pt, weight: "bold")[Contents]
  #v(0.3in)

  #outline(
    title: none,
    indent: 1.2em,
    depth: 2,
  )
]

// ============================================================
// 1. EXECUTIVE SUMMARY
// ============================================================

= Executive Summary

Enterprise AI agents can send emails, update records, and file tickets. They cannot predict what those actions cause downstream. They operate on task descriptions and tool interfaces without any model of the systems they act within. A collection email sent to the wrong customer at the wrong time can trigger a cascade: a disputed charge, a churned account, a missed renewal.

This failure mode has a name. The "World of Workflows" benchmark (arXiv, January 2026) calls it _dynamics blindness_: the inability of task-oriented agents to model the hidden state transitions their actions cause. Frontier LLMs, tested against 234 enterprise tasks with over 4,000 active business rules, consistently failed to predict which rules would fire, what side effects would propagate, and which constraints would break.

Nooterra is an enterprise world model platform. It builds a real-time representation of a company's operational state across connected business systems. It uses that model to predict downstream effects, govern agent actions through deterministic policy, and grant autonomy only when statistical evidence justifies it.

The system is live today with Stripe as the first world-model source. It ingests webhooks, constructs a canonical object graph of customers, invoices, payments, and disputes, runs calibrated prediction models, and governs agent actions through an evidence-based approval pipeline. Multi-source expansion (Gmail, QuickBooks, CRM) is in active development.

This document describes the architecture, the current product, the commercial model, and the path from Stripe-first wedge to multi-domain platform.

// ============================================================
// 2. THE PROBLEM
// ============================================================

= The Problem: Dynamics Blindness

Enterprise software systems are opaque. A single business action triggers cascading effects across multiple systems: accounting entries, compliance checks, customer relationship signals, support ticket state changes, revenue recognition adjustments. These downstream effects are governed by thousands of business rules, most of which are invisible to any individual system or user.

When a skilled human employee takes an action, they run an implicit mental model. They consider the customer's payment history, open support tickets, pending renewals, and relationship context. This situational awareness is what makes human judgment valuable in enterprise operations.

Current AI agent architectures lack this capability. They operate on visible task descriptions and available tool interfaces. No persistent model of company state. No awareness of cross-system relationships. No prediction of downstream effects.

#v(0.4em)

#diagram-box("Figure 1: Dynamics blindness in practice")[
  #set text(9.5pt)
  #grid(
    columns: (1fr, 24pt, 1fr),
    gutter: 0pt,
    [
      #text(weight: "bold")[What the agent sees:]
      #v(6pt)
      #block(
        fill: luma(248),
        inset: 10pt,
        radius: 3pt,
        width: 100%,
      )[
        Invoice \#4821 overdue 14 days \
        Action: Send collection email
      ]
    ],
    align(center + horizon, text(16pt, fill: luma(160))[-->]),
    [
      #text(weight: "bold")[What actually happens:]
      #v(6pt)
      #set text(9pt)
      #stack(
        dir: ttb,
        spacing: 4pt,
        block(fill: luma(248), inset: 8pt, radius: 3pt, width: 100%)[
          Stripe: payment retry already scheduled \
          _Customer receives two conflicting messages_
        ],
        block(fill: luma(248), inset: 8pt, radius: 3pt, width: 100%)[
          Support: open ticket escalated to manager \
          _Collection email undermines support relationship_
        ],
        block(fill: luma(248), inset: 8pt, radius: 3pt, width: 100%)[
          CRM: contract renewal in 9 days \
          _Churn probability jumps from 40% to 78%_
        ],
      )
    ],
  )
]

#v(0.4em)

The cost is measurable. U.S. small businesses with unpaid invoices carry \$17,500 in overdue receivables on average (QuickBooks, May 2025). Mid-market firms carry approximately \$304,000. These are not technology problems. They are dynamics problems: businesses lack the operational intelligence to predict which invoices will go overdue, which customers are at risk, and what actions will accelerate collection without damaging relationships.

Naive automation makes things worse. Templated reminders on a timer ignore context that a human would naturally consider. The "World of Workflows" researchers built a ServiceNow-based environment with 234 benchmark tasks and demonstrated that even frontier LLMs consistently fail to predict hidden state transitions. The conclusion: enterprise AI agents need explicit world models.

// ============================================================
// 3. WHAT WE BUILT
// ============================================================

= What We Built

Nooterra is not an AI agent framework, a workflow automation tool, or an LLM wrapper. It is a governed enterprise world model with six core subsystems.

#v(0.4em)

#diagram-box("Figure 2: System architecture")[
  #set text(9pt)
  #v(4pt)

  // Source systems row
  #align(center)[
    #grid(
      columns: (auto, auto, auto, auto),
      gutter: 12pt,
      box(stroke: 1pt + luma(30), radius: 3pt, inset: (x: 12pt, y: 6pt), fill: luma(30), text(fill: white, weight: "bold")[Stripe]),
      box(stroke: 0.6pt + luma(180), radius: 3pt, inset: (x: 12pt, y: 6pt), fill: luma(245))[Gmail],
      box(stroke: 0.6pt + luma(180), radius: 3pt, inset: (x: 12pt, y: 6pt), fill: luma(245))[QuickBooks],
      box(stroke: 0.6pt + luma(180), radius: 3pt, inset: (x: 12pt, y: 6pt), fill: luma(245))[CRM],
    )
  ]

  #v(2pt)
  #align(center, text(14pt, fill: luma(160))[|])
  #align(center, text(14pt, fill: luma(160))[v])
  #v(2pt)

  // Core pipeline
  #let pipe-box(title, desc, dark: false) = {
    box(
      width: 100%,
      stroke: if dark { 1pt + luma(30) } else { 0.6pt + luma(180) },
      radius: 3pt,
      inset: (x: 10pt, y: 7pt),
      fill: if dark { luma(30) } else { white },
    )[
      #text(weight: "bold", fill: if dark { white } else { luma(30) })[#title] \
      #text(8.5pt, fill: if dark { luma(180) } else { luma(100) })[#desc]
    ]
  }

  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 6pt,
    pipe-box("Event Ledger", "Append-only, hash-chained, bi-temporal"),
    pipe-box("Object Graph", "Typed entities, relationships, provenance"),
    pipe-box("State Estimator", "Confidence intervals, calibration tracking"),
  )
  #v(4pt)
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 6pt,
    pipe-box("Policy Runtime", "Deterministic rules, predicate evaluation"),
    pipe-box("Action Gateway", "Propose, approve, execute with evidence", dark: true),
    pipe-box("Autonomy Engine", "Statistical promotion and demotion"),
  )

  #v(8pt)
  #line(length: 100%, stroke: (dash: "dashed", paint: luma(180), thickness: 0.4pt))
  #v(4pt)

  // LLM boundary
  #text(8pt, fill: luma(120), weight: "bold")[LLM BOUNDARY (bounded, optional, fallback-safe)]
  #v(4pt)
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 6pt,
    box(stroke: 0.4pt + luma(200), radius: 3pt, inset: 6pt, fill: luma(252))[
      #text(8.5pt)[Semantic extraction \ _parse unstructured inputs_]
    ],
    box(stroke: 0.4pt + luma(200), radius: 3pt, inset: 6pt, fill: luma(252))[
      #text(8.5pt)[Content generation \ _draft emails, explanations_]
    ],
    box(stroke: 0.4pt + luma(200), radius: 3pt, inset: 6pt, fill: luma(252))[
      #text(8.5pt)[Entity resolution \ _match across systems_]
    ],
  )
]

#v(0.4em)

The LLM is used for four functions: semantic extraction, action content generation, entity resolution, and context narration. It is not used for making predictions (that is the statistical model), making policy decisions (that is the rule engine), granting autonomy (that is the evidence-based promotion system), or storing state (that is the database). Every LLM call has a maximum token budget, a retry limit, and a template-based fallback. If the LLM is unavailable, the system continues operating.

=== Current Product Status

The system ships in three tiers of maturity. This distinction matters for diligence and is maintained throughout.

#v(0.4em)

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 8pt,
  fill: (x, y) => if y == 0 { luma(30) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold")[Status],
    text(fill: white, weight: "bold")[Details],
  ),
  [#badge("Shipped", dark: true)],
  [
    Stripe world-model source (webhooks, typed events, canonical objects). Event ledger with hash-chained integrity. Object graph with customers, invoices, payments, disputes, relationships. State estimator with confidence intervals. Policy runtime with deterministic rule evaluation. Action gateway with evidence bundles. Earned autonomy with statistical promotion/demotion. Eight production dashboard views. 253 passing tests (unit, integration, contract, chaos, load). Production infrastructure on Railway (PostgreSQL, Redis). Multi-provider LLM routing (OpenAI, Anthropic, Google via OpenRouter).
  ],
  [#badge("Building")],
  [
    Multi-source connectors (Gmail, QuickBooks, CRM). Simulation engine for pre-execution "what if" scenarios. Closed-loop calibration feeding outcomes back to prediction models.
  ],
  [#badge("Target")],
  [
    Cross-domain cascade modeling. Domain pack SDK for third-party vertical extensions. Causal inference models replacing correlational predictions. Privacy-preserving transfer learning across tenants.
  ],
)

// ============================================================
// 4. THE WORLD MODEL
// ============================================================

= The World Model

The world model is the core intellectual property. It is a persistent, multi-source, calibrated representation of a company's operational state.

== Observation

Connected business systems emit events ingested into the event ledger. Each event is typed, timestamped, hash-chained for integrity, and carries provenance metadata identifying its source system and causal chain. Events transform deterministically into objects and relationships in the canonical object graph.

Today, Stripe is the live world-model source. Webhooks for invoice creation, payment success and failure, dispute opening, and customer events are ingested and transformed into five canonical object types: Party (customer), Invoice, Payment, Dispute, and Conversation.

== Estimation

Not all relevant business state is directly observable. A customer's likelihood of paying an invoice, their churn risk, the probability of a dispute: these are estimated fields derived from observable data through statistical models. Each estimated field carries a value, a confidence interval, the model version that produced it, a feature snapshot, and a calibration history.

The estimation layer uses a progression of model complexity:

+ *Rule-based heuristics* (interpretable, fast to deploy, default for new tenants)
+ *Gradient-boosted statistical models* (XGBoost, logistic regression, deployed when calibration evidence justifies it)
+ *Causal and intervention models* (target architecture, deployed as outcome data accumulates)

Each level is promoted only when calibration evidence justifies the transition.

== Prediction Targets

For the initial AR domain:

#table(
  columns: (1fr, auto, auto),
  stroke: 0.4pt + luma(200),
  inset: 8pt,
  fill: (x, y) => if y == 0 { luma(30) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold")[Target],
    text(fill: white, weight: "bold")[Type],
    text(fill: white, weight: "bold")[Horizon],
  ),
  [Payment probability], [Float \[0,1\]], [7, 30, 90 days],
  [Days to payment], [Distribution], [Per invoice],
  [Churn risk], [Float \[0,1\]], [30, 90 days],
  [Dispute probability], [Float \[0,1\]], [Per invoice],
  [Customer lifetime value], [Distribution], [12 months],
  [DSO forecast], [Distribution], [30/60/90 days],
)

== Calibration and Trust

Every prediction is stored with its eventual outcome. Calibration reports compare predicted probabilities against observed frequencies. A model that predicts 70% payment probability should see approximately 70% of those invoices paid. When calibration drifts beyond acceptable thresholds, the system flags the model for review and falls back to more conservative estimates.

This infrastructure is what makes the world model trustworthy. Users can inspect the system's track record for any prediction class and verify that its confidence claims are honest.

#v(0.4em)

#diagram-box("Figure 3: World model pipeline (concrete example)")[
  #set text(9pt)
  #grid(
    columns: (1fr, 14pt, 1fr, 14pt, 1fr, 14pt, 1fr),
    gutter: 0pt,
    align: center + horizon,
    [
      #box(stroke: 0.6pt + luma(180), radius: 3pt, inset: 8pt, width: 100%, fill: luma(248))[
        #text(8pt, weight: "bold")[1. OBSERVE]
        #v(4pt)
        #text(8.5pt)[
          Stripe webhook: \ `invoice.payment_failed` \ \$4,200 from Acme Corp
        ]
      ]
    ],
    text(fill: luma(160))[->],
    [
      #box(stroke: 0.6pt + luma(180), radius: 3pt, inset: 8pt, width: 100%, fill: luma(248))[
        #text(8pt, weight: "bold")[2. MODEL]
        #v(4pt)
        #text(8.5pt)[
          Object graph updated: \ Customer: Acme Corp \ Invoice \#4821: overdue \ 3 open support tickets
        ]
      ]
    ],
    text(fill: luma(160))[->],
    [
      #box(stroke: 0.6pt + luma(180), radius: 3pt, inset: 8pt, width: 100%, fill: luma(248))[
        #text(8pt, weight: "bold")[3. ESTIMATE]
        #v(4pt)
        #text(8.5pt)[
          Payment prob: 0.34 \ CI: \[0.22, 0.47\] \ Churn risk: 0.71 \ Model: xgb_v3
        ]
      ]
    ],
    text(fill: luma(160))[->],
    [
      #box(stroke: 1pt + luma(30), radius: 3pt, inset: 8pt, width: 100%, fill: luma(30))[
        #text(8pt, weight: "bold", fill: white)[4. ACT]
        #v(4pt)
        #text(8.5pt, fill: luma(200))[
          Soft reminder \ Personal tone \ Evidence: tickets, \ renewal in 9 days \ Trust: Supervised
        ]
      ]
    ],
  )
]

// ============================================================
// 5. GOVERNED AUTONOMY
// ============================================================

= Governed Autonomy: Earned, Not Granted

The most consequential design decision in Nooterra is its approach to AI autonomy. Rather than deploying agents with fixed permission sets, the system implements statistical promotion where each action class independently earns the right to execute with reduced human oversight.

== Trust Levels

#table(
  columns: (auto, 1fr, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 8pt,
  fill: (x, y) => if y == 0 { luma(30) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold")[Level],
    text(fill: white, weight: "bold")[Behavior],
    text(fill: white, weight: "bold")[Promotion Criteria],
  ),
  [*Locked*], [Action type forbidden], [Explicit policy enablement],
  [*Shadow*], [System proposes, no user visibility], [Internal testing only],
  [*Supervised*], [User approves each action], [Default for new action types],
  [*Auto + Review*], [Executes, user reviews after], [See thresholds below],
  [*Autonomous*], [No human involvement], [See thresholds below],
)

== Precise Definitions

These terms are used throughout the promotion criteria. Each is defined here to support auditability.

*Procedural score.* Did the action follow the policy template? Measured as the percentage of policy predicates that evaluated to `true` at execution time. An action that skipped a required check or deviated from the prescribed sequence scores lower. Binary per-predicate, averaged across the action.

*Outcome score.* Did the predicted result match the observed result? Measured as whether the actual outcome fell within the model's predicted confidence interval. A payment prediction of 0.70 [0.55, 0.85] where the invoice was paid scores 1.0. An invoice predicted at 0.70 that went to dispute scores 0.0. Averaged across the action class over the evaluation window.

*Incident.* Any of: (a) a customer complaint attributed to the action, (b) a constraint violation detected post-execution, or (c) an observed outcome outside 2-sigma of the model's prediction for that action. Severity is classified as minor (recoverable, no customer impact), moderate (customer-visible, recoverable), or critical (financial loss, relationship damage, or compliance violation).

== Promotion Thresholds

Promotion from Supervised to Auto + Review requires all of the following within a rolling 30-day window, evaluated per action class, per tenant:

- At least 20 completed executions
- Procedural score at or above 85%
- Outcome score at or above 75%
- At most 1 minor incident, 0 moderate or critical incidents

Promotion from Auto + Review to Autonomous requires all of the following within a rolling 60-day window:

- At least 50 completed executions
- Procedural score at or above 90%
- Outcome score at or above 80%
- Zero incidents of any severity

== Asymmetric Demotion

Promotion is slow and evidence-based. Demotion is immediate. A single moderate or critical incident triggers automatic demotion to Supervised mode for the affected action class. The system notifies the human operator, provides a full evidence bundle explaining what happened, and resets the trust score. This asymmetry is deliberate: the cost of a false positive (unnecessary human review) is always lower than the cost of a false negative (unsupervised mistake).

== Sparse-Data Safeguards

In low-volume environments where 20 or 50 executions may take months to accumulate, the system does not promote. It remains in Supervised mode and alerts the operator that insufficient data is available for trust evaluation. There is no interpolation, no borrowed confidence from other tenants, and no default promotion schedule. Trust is earned from the tenant's own operational data or not at all.

#v(0.4em)

#diagram-box("Figure 4: Autonomy progression")[
  #set text(9pt)
  #align(center)[
    #grid(
      columns: (auto, 16pt, auto, 16pt, auto, 16pt, auto, 16pt, auto),
      gutter: 0pt,
      align: center + horizon,
      box(stroke: 0.6pt + luma(180), radius: 3pt, inset: 8pt, fill: white)[
        #text(8pt, weight: "bold")[Locked]
      ],
      text(fill: luma(160))[->],
      box(stroke: 0.6pt + luma(180), radius: 3pt, inset: 8pt, fill: luma(248))[
        #text(8pt, weight: "bold")[Shadow]
      ],
      text(fill: luma(160))[->],
      box(stroke: 0.6pt + luma(150), radius: 3pt, inset: 8pt, fill: luma(240))[
        #text(8pt, weight: "bold")[Supervised]
      ],
      text(fill: luma(160))[->],
      box(stroke: 0.6pt + luma(120), radius: 3pt, inset: 8pt, fill: luma(220))[
        #text(8pt, weight: "bold")[Auto+Review]
      ],
      text(fill: luma(160))[->],
      box(stroke: 1pt + luma(30), radius: 3pt, inset: 8pt, fill: luma(30))[
        #text(8pt, weight: "bold", fill: white)[Autonomous]
      ],
    )
  ]
  #v(8pt)
  #align(center)[
    #text(8.5pt, fill: luma(100))[
      Promotion: weeks to months, evidence-based #h(24pt) Demotion: immediate on any incident
    ]
  ]
]

// ============================================================
// 6. SECURITY, GOVERNANCE, AND DATA HANDLING
// ============================================================

= Security, Governance, and Data Handling

A platform that models company-wide operational state must answer the question of trust before it answers the question of capability. This section covers the mechanisms that protect tenant data and enforce operational boundaries.

== Tenant Isolation

Every tenant operates in a fully isolated data partition. The event ledger, object graph, state estimates, policy rules, and autonomy scores are partitioned by tenant ID at the database level. There is no shared state between tenants. Cross-tenant queries are architecturally impossible: the query layer enforces tenant scoping at the connection level, not at the application level.

== Authentication and Authorization

User authentication is handled through magic link (email OTP) and passkey-based flows, with no password storage. The authorization model uses a Zanzibar-style directed acyclic graph for permission evaluation. Each action in the gateway pipeline is checked against the authority graph before execution. Approval authority is explicit: only users with the appropriate grant can approve actions in a given action class.

== Audit and Evidence

Every action executed through the gateway produces a complete evidence bundle: the proposed action, the policy predicates evaluated, the state estimates at decision time, the approval (human or automatic), the execution result, and the observed outcome. These bundles are stored in the append-only event ledger with hash-chain integrity. They are immutable and retained for the lifetime of the tenant account.

== Data Handling

The system ingests business events from connected sources (currently Stripe webhooks). It stores typed event records and derived object state. It does not store raw credentials for connected systems beyond OAuth tokens managed through the connector framework. PII fields (customer names, email addresses) are stored as received from the source system and are subject to the tenant's data retention configuration. Tenant data deletion is supported: removing a tenant removes all associated events, objects, estimates, and policy state.

== Incident Response

When the autonomy engine detects an incident (constraint violation, outcome outside confidence bounds, or customer complaint), it triggers an automatic response sequence: demote the affected action class, notify the human operator with the full evidence bundle, and log the incident with severity classification. Critical incidents additionally pause all autonomous actions for the tenant until a human reviews and explicitly re-enables them.

// ============================================================
// 7. WHY THIS WINS
// ============================================================

= Competitive Landscape

#table(
  columns: (auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 8pt,
  fill: (x, y) => if y == 0 { luma(30) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold")[Category],
    text(fill: white, weight: "bold")[Examples],
    text(fill: white, weight: "bold")[What They Lack],
  ),
  [AI Agent Frameworks], [CrewAI, AutoGen, LangGraph], [No world model, no governance, no persistent state, no predictions. Developer tooling, not a product.],
  [Vertical AR Tools], [Tesorio, Upflow, Bill.com], [Timer-based reminders. No state estimation, no cross-domain awareness, no earned autonomy.],
  [Workflow Automation], [Zapier, Make, n8n], [Task execution without dynamics understanding. No simulation, no governance.],
  [Foundation Model Cos.], [Anthropic, OpenAI, Google], [Platform companies selling APIs and general-purpose agents. Vertical operations products require domain-specific world models they are unlikely to build.],
)

== Defensible Advantages

*Proprietary approval and outcome data.* Every tenant's approvals, rejections, outcomes, and incidents become training signal. This data does not exist anywhere else. No public dataset contains enterprise action-outcome pairs with full context, policy state, and confidence intervals attached.

*Trust lock-in.* Once a company has spent months training autonomy levels, building custom policies, and calibrating predictions, switching means starting at zero trust. Trust cannot be exported because it is a function of the operational history within the system.

*Policy-runtime depth.* The combination of event ledger, object graph, state estimator, policy runtime, and earned autonomy is 12 to 18 months of hard engineering. The first team to ship it with a working product has a structural head start.

*Cross-domain compounding.* Each new data source added to the platform increases the value of every existing source. When AR, Support, and Sales are all connected, the world model can reason across domains. A collection strategy informed by open support tickets and pending renewals is structurally impossible for single-domain vertical tools.

// ============================================================
// 8. COMMERCIAL MODEL
// ============================================================

= Commercial Model

Nooterra prices on business value, not compute consumption. The primary metric is monitored invoice volume. The product does not price by tokens, agent runs, or tool calls.

#table(
  columns: (auto, auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 8pt,
  fill: (x, y) => if y == 0 { luma(30) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold")[Tier],
    text(fill: white, weight: "bold")[Price],
    text(fill: white, weight: "bold")[Target],
    text(fill: white, weight: "bold")[Key Features],
  ),
  [Sandbox], [Free (14-30 days)], [Evaluation], [1 Stripe account, shadow mode, no autonomous sends],
  [Starter], [\$149/mo], [Founder-led SMBs], [1 agent, Stripe world model, approval queue, predictions],
  [Business], [\$499/mo], [Growing businesses], [Full autonomy, multiple runtimes, Slack approvals],
  [Finance Ops], [\$799-1,500/mo], [Finance teams], [Multi-user, audit/export, custom policies],
  [Enterprise], [Custom], [Mid-market+], [Multi-system, SSO/SCIM, custom connectors, SLA],
)

#v(0.3em)

Unit economics at the Business tier: LLM cost of approximately \$50/month per customer yields a gross margin of approximately 83%.

== Go-to-Market

*Months 1-6:* Design partner pilots. Hand-selected B2B service companies. Free access in exchange for weekly feedback. Goal: prove activation, ROI, and earned-autonomy mechanics with 5-10 partners.

*Months 4-8:* Invite-only launch. 50 companies from waitlist. Paid Starter and Business tiers. Content marketing with partner case studies.

*Months 7-12:* Open access. Self-serve sandbox trial. Bookkeeper and accountant referral program.

// ============================================================
// 9. ROADMAP
// ============================================================

= Roadmap: From Wedge to Platform

The expansion sequence is designed to compound data advantages at each stage. Each phase builds on the data and operational trust earned in the previous one.

#table(
  columns: (auto, auto, 1fr, auto),
  stroke: 0.4pt + luma(200),
  inset: 8pt,
  fill: (x, y) => if y == 0 { luma(30) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold")[Phase],
    text(fill: white, weight: "bold")[Timeline],
    text(fill: white, weight: "bold")[Milestone],
    text(fill: white, weight: "bold")[Success Metric],
  ),
  [AR Wedge], [Months 1-6], [Stripe world model. Shadow collections. Governed actions. Earned autonomy.], [5-10 design partners, measurable DSO reduction],
  [Finance Control Plane], [Months 7-12], [Multi-source state (Gmail, QuickBooks). Refunds and disputes. Simulation v1. Cash forecasting.], [200 paying customers],
  [Multi-Domain Platform], [Months 13-24], [CRM integration. Cross-domain relationships. Domain pack SDK. Support ops, procurement.], [1,000+ customers, Enterprise deals],
)

#v(0.3em)

The wedge is AR collections on Stripe. This is chosen deliberately: Stripe has the best API surface in enterprise SaaS, the data is financially dense (every event has a dollar value), and the feedback loops are fast (did the invoice get paid or not). This produces high-quality training data for the world model faster than any other starting point.

Later expansion into disputes, support, revenue operations, and procurement follows the same pattern. Each domain is added only when the platform infrastructure (event ledger, object graph, policy runtime, autonomy engine) has been validated in the previous domain. Expansion is earned, not enumerated.

// ============================================================
// CLOSING
// ============================================================

#v(1em)
#line(length: 100%, stroke: 0.4pt + luma(200))
#v(0.6em)

#align(center)[
  #text(11pt, weight: "bold", tracking: 4pt, fill: luma(100))[NOOTERRA]

  #v(0.2em)

  #text(10pt, fill: luma(80))[
    Enterprise World Model Platform \
    nooterra.ai
  ]

  #v(0.3em)

  #text(9pt, fill: luma(140))[
    April 2026. Confidential.
  ]
]
