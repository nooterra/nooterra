// ============================================================
// NOOTERRA WHITEPAPER v4 — Definitive version
// Monochrome. Investor-first. 14-16 pages.
// Merges v3 writing quality with professional design.
// ============================================================

#set document(
  title: "Nooterra: Enterprise World Model Platform",
  author: "Nooterra, Inc.",
  date: datetime(year: 2026, month: 4, day: 1),
)

#set page(
  paper: "us-letter",
  margin: (top: 1.15in, bottom: 1in, left: 1.05in, right: 1.05in),
  header: context {
    if counter(page).get().first() > 1 [
      #set text(7.5pt, fill: luma(150), tracking: 1.5pt)
      NOOTERRA #h(1fr) #text(tracking: 0pt)[Enterprise World Model Platform]
      #v(-3pt)
      #line(length: 100%, stroke: 0.3pt + luma(210))
    ]
  },
  footer: context {
    if counter(page).get().first() > 1 [
      #line(length: 100%, stroke: 0.3pt + luma(210))
      #v(3pt)
      #set text(7.5pt, fill: luma(150))
      Confidential #h(1fr) #counter(page).display() #h(1fr) nooterra.ai
    ]
  },
)

#set text(
  font: "Helvetica Neue",
  size: 10pt,
  fill: luma(25),
)

#set par(
  leading: 0.7em,
  justify: true,
  first-line-indent: 0pt,
)

#set heading(numbering: "1.")

#show heading.where(level: 1): it => {
  v(1em)
  block(below: 0.5em)[
    #text(15pt, weight: "bold", it)
  ]
}

#show heading.where(level: 2): it => {
  v(0.7em)
  block(below: 0.3em)[
    #text(11pt, weight: "bold", it)
  ]
}

#show heading.where(level: 3): it => {
  v(0.5em)
  block(below: 0.2em)[
    #text(10pt, weight: "bold", it)
  ]
}

// --- Utility: callout box (left-bordered) ---
#let callout(body) = {
  block(
    width: 100%,
    fill: luma(250),
    stroke: (left: 2.5pt + luma(80)),
    inset: (left: 14pt, right: 14pt, top: 10pt, bottom: 10pt),
    radius: (right: 3pt),
    body,
  )
}

// --- Utility: figure box ---
#let fig(title, body) = {
  block(
    width: 100%,
    stroke: 0.5pt + luma(190),
    radius: 3pt,
    clip: true,
  )[
    #block(
      width: 100%,
      fill: luma(247),
      inset: (x: 12pt, y: 7pt),
    )[
      #text(8pt, weight: "bold", fill: luma(90), tracking: 0.5pt, upper(title))
    ]
    #block(
      width: 100%,
      inset: (x: 14pt, y: 12pt),
      body,
    )
  ]
}

// --- Utility: badge ---
#let badge(label, dark: false) = {
  box(
    fill: if dark { luma(25) } else { luma(238) },
    radius: 2pt,
    inset: (x: 7pt, y: 2.5pt),
    text(
      7.5pt,
      weight: "bold",
      fill: if dark { white } else { luma(70) },
      tracking: 0.3pt,
      upper(label),
    ),
  )
}

// --- Utility: small subsystem box for diagrams ---
#let sysbox(title, desc, dark: false) = {
  box(
    width: 100%,
    stroke: if dark { 0.8pt + luma(25) } else { 0.5pt + luma(190) },
    radius: 3pt,
    inset: (x: 8pt, y: 6pt),
    fill: if dark { luma(25) } else { white },
  )[
    #text(9pt, weight: "bold", fill: if dark { white } else { luma(25) })[#title] \
    #text(8pt, fill: if dark { luma(170) } else { luma(110) })[#desc]
  ]
}


// ============================================================
// COVER PAGE
// ============================================================

#page(header: none, footer: none)[
  #v(2in)

  #text(10pt, weight: "bold", tracking: 5pt, fill: luma(120))[NOOTERRA]

  #v(0.4in)

  #text(26pt, weight: "bold", tracking: -0.3pt)[Enterprise World Model Platform]

  #v(0.15in)

  #block(width: 85%)[
    #text(11pt, fill: luma(70), weight: "regular")[
      Governing AI action through persistent business state. \
      Why enterprise agents fail without state, and how world models \
      make autonomy safe, auditable, and economically useful.
    ]
  ]

  #v(1.8in)

  #text(9.5pt, fill: luma(130))[
    Confidential draft for qualified partners and investors \
    April 2026
  ]

  #v(1fr)

  #line(length: 100%, stroke: 0.3pt + luma(210))
  #v(5pt)
  #text(8.5pt, fill: luma(140))[nooterra.ai]
]


// ============================================================
// TABLE OF CONTENTS
// ============================================================

#page(header: none, footer: none)[
  #v(0.4in)
  #text(16pt, weight: "bold")[Contents]
  #v(0.4in)
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

Enterprise AI is advancing quickly at the task layer. Models can draft messages, call tools, summarize context, and complete multi-step workflows. What they still do poorly is understand the operational systems they act within.

That gap matters more than raw model capability. In production environments, the hardest problem is rarely whether an agent can take an action. The harder problem is whether it can predict what that action will cause downstream across billing, support, CRM, finance, approvals, and compliance.

Nooterra is building an enterprise world model platform: a persistent, governed representation of business state that sits between AI agents and enterprise systems. The platform ingests events from connected software, constructs a canonical object graph, estimates hidden operational state, evaluates policy constraints, and governs action through an approval and autonomy framework that is earned through evidence rather than granted by default.

The product begins with a narrow and deliberate wedge: Stripe-first accounts receivable operations. This domain offers the right combination of clean event streams, fast feedback loops, financially meaningful outcomes, and clear governance needs. It is the fastest way to prove that a world model can create practical value, not just architectural elegance.

#v(0.3em)
#callout[
  #text(9.5pt)[
    *The thesis is straightforward:* enterprise agents fail because they act from prompts and tool surfaces rather than from durable state. The company that captures the richest action-outcome history inside a governed operational runtime will own a defensible data and trust advantage.
  ]
]

#v(0.3em)

This paper explains why enterprise world models are emerging as a distinct category, what makes them technically different from both physical world models and conventional agent frameworks, why Stripe-first receivables is the correct first product, and how that wedge expands into a broader operating substrate for enterprise autonomy.


// ============================================================
// 2. WHY NOW
// ============================================================

= Why Now

Three conditions make this the right moment to build an enterprise world model.

== Agent adoption is outpacing governance

Enterprise spending on AI agent infrastructure grew over 300% year-over-year in 2025. Every major platform company now ships agent frameworks. But deployment failures are accumulating. Agents can execute tasks. They cannot predict consequences. The governance gap is widening faster than the capability gap. Every failed deployment increases buyer appetite for a trust layer.

== The research consensus has crystallized

The "World of Workflows" benchmark (arXiv, January 2026) gave the problem a name, a measurement framework, and proof that frontier LLMs cannot solve it through scale alone. Enterprise AI needs an architectural solution: explicit world models that sit between agents and enterprise systems. The academic consensus now supports the product thesis.~[1]

== API surface quality has reached critical mass

Stripe, QuickBooks, Gmail, Salesforce, and ServiceNow now offer real-time event streams with sufficient granularity to construct operational world models. Five years ago, this data was trapped in batch exports and screen scraping. The infrastructure is ready. The intelligence layer is missing.


// ============================================================
// 3. THE MISSING LAYER
// ============================================================

= The Missing Layer in Enterprise AI

Most AI systems deployed in business today follow one of three patterns. The *assistant* pattern: a model answers questions, summarizes documents, or drafts content. Useful, but passive. The *automation* pattern: a workflow engine moves data between systems on predefined triggers. Scalable, but brittle when context is ambiguous. The *agent* pattern: a model is given tools and goals, then allowed to act. Powerful, but dangerous when it lacks a coherent picture of the system it operates inside.

All three share the same structural weakness. They are thin on state.

An enterprise operation is not a single task. It is a web of objects, relationships, deadlines, constraints, and side effects. A collection reminder is not just an email. It sits inside a revenue process, a service relationship, a payment history, a dispute surface, and often a renewal cycle.

Human operators reason through this implicitly. They keep a mental model of the customer, the business context, and the likely consequences of action. AI systems do not.

#v(0.4em)

#fig("Figure 1: What agents miss")[
  #set text(9pt)
  #grid(
    columns: (1fr, 20pt, 1fr),
    gutter: 0pt,
    [
      *What the agent sees:*
      #v(5pt)
      #block(fill: luma(248), inset: 9pt, radius: 2pt, width: 100%)[
        Invoice \#4821 from Acme Corp \
        Overdue 14 days, \$4,200 \
        Available action: send collection email
      ]
    ],
    align(center + horizon, text(14pt, fill: luma(170))[#sym.arrow.r]),
    [
      *What actually happens:*
      #v(5pt)
      #set text(8.5pt)
      #stack(
        dir: ttb,
        spacing: 3pt,
        block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
          Stripe: payment retry already scheduled. \
          _Customer receives two conflicting messages._
        ],
        block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
          Support: open ticket escalated to manager. \
          _Collection email undermines the support relationship._
        ],
        block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
          CRM: contract renewal in 9 days. \
          _Churn probability jumps from 40% to 78%._
        ],
      )
    ],
  )
]

#v(0.3em)

This is why so many enterprise AI deployments look impressive in demonstration and unsafe in production. The model completes the visible step. It cannot reason over the invisible dynamics around that step.


// ============================================================
// 4. WHY ENTERPRISE WORLD MODELS ARE DISTINCT
// ============================================================

= Why Enterprise World Models Are a Distinct Technical Category

The phrase "world model" is typically associated with robotics, autonomous driving, or video generation, where the system models physical reality. Enterprise world models solve a different class of problem.

An enterprise runs on symbolic state rather than physical state. The important transitions are invoice overdue, dispute opened, approval granted, renewal at risk, payment settled, service ticket escalated, contract amended. These are state transitions in software, policy, and human workflow, not physical events.

#v(0.3em)

#table(
  columns: (auto, 1fr, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Dimension],
    text(fill: white, weight: "bold", size: 8.5pt)[Physical World Models],
    text(fill: white, weight: "bold", size: 8.5pt)[Enterprise World Models],
  ),
  text(9pt, weight: "bold")[State],
  text(9pt)[Pixels, point clouds, spatial coordinates],
  text(9pt)[Records, APIs, workflow rules, entitlements],
  text(9pt, weight: "bold")[Dynamics],
  text(9pt)[Physics, collisions, trajectories],
  text(9pt)[Side effects across systems, hidden rule cascades],
  text(9pt, weight: "bold")[Objective],
  text(9pt)[Predict next frame of reality],
  text(9pt)[Decide if an action should happen and what it will cause],
  text(9pt, weight: "bold")[Feedback],
  text(9pt)[Sensor readings, video frames],
  text(9pt)[Operational outcomes: payments, complaints, approvals],
  text(9pt, weight: "bold")[Training data],
  text(9pt)[Public video, simulation, synthetic],
  text(9pt)[Proprietary action-outcome history from customer operations],
)

#v(0.3em)

This distinction matters strategically. The raw material for improvement is not public text or video. It is proprietary action-outcome history generated inside customer operations. That data does not exist in any public dataset. Enterprise world models should be understood as a new systems layer, not a minor extension of agent tooling.


// ============================================================
// 5. SYSTEM ARCHITECTURE
// ============================================================

= Nooterra System Architecture

Nooterra is a hybrid system. The language model is a bounded reasoning component within a larger operational architecture. It is not the system of record, not the policy authority, and not the source of trust.

#v(0.4em)

#fig("Figure 2: Platform architecture")[
  #set text(8.5pt)
  #v(2pt)

  // Source systems
  #align(center)[
    #text(7.5pt, fill: luma(100), weight: "bold", tracking: 0.5pt)[CONNECTED SYSTEMS]
    #v(4pt)
    #grid(
      columns: (auto, auto, auto, auto),
      gutter: 8pt,
      box(stroke: 0.8pt + luma(25), radius: 2pt, inset: (x: 10pt, y: 5pt), fill: luma(25), text(fill: white, weight: "bold", size: 8.5pt)[Stripe]),
      box(stroke: 0.4pt + luma(190), radius: 2pt, inset: (x: 10pt, y: 5pt), fill: luma(247), text(size: 8.5pt)[Gmail]),
      box(stroke: 0.4pt + luma(190), radius: 2pt, inset: (x: 10pt, y: 5pt), fill: luma(247), text(size: 8.5pt)[QuickBooks]),
      box(stroke: 0.4pt + luma(190), radius: 2pt, inset: (x: 10pt, y: 5pt), fill: luma(247), text(size: 8.5pt)[CRM]),
    )
  ]

  #v(4pt)
  #align(center, text(12pt, fill: luma(170))[#sym.arrow.b])
  #v(4pt)

  // Core subsystems
  #text(7.5pt, fill: luma(100), weight: "bold", tracking: 0.5pt)[CORE PLATFORM]
  #v(4pt)
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 5pt,
    sysbox("Event Ledger", "Append-only, hash-chained, bi-temporal"),
    sysbox("Object Graph", "Typed entities, relationships, provenance"),
    sysbox("Belief Layer", "Estimates, confidence, calibration"),
  )
  #v(4pt)
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 5pt,
    sysbox("Policy Runtime", "Deterministic rules over object graph"),
    sysbox("Action Gateway", "Propose, approve, execute, record", dark: true),
    sysbox("Autonomy Engine", "Statistical promotion and demotion"),
  )

  #v(6pt)
  #line(length: 100%, stroke: (dash: "dashed", paint: luma(190), thickness: 0.3pt))
  #v(4pt)

  // LLM boundary
  #text(7.5pt, fill: luma(120), weight: "bold", tracking: 0.3pt)[LLM BOUNDARY (bounded, optional, fallback-safe)]
  #v(4pt)
  #grid(
    columns: (1fr, 1fr, 1fr, 1fr),
    gutter: 5pt,
    box(stroke: 0.3pt + luma(210), radius: 2pt, inset: 5pt, fill: luma(252))[
      #text(8pt)[Semantic \ extraction]
    ],
    box(stroke: 0.3pt + luma(210), radius: 2pt, inset: 5pt, fill: luma(252))[
      #text(8pt)[Content \ generation]
    ],
    box(stroke: 0.3pt + luma(210), radius: 2pt, inset: 5pt, fill: luma(252))[
      #text(8pt)[Entity \ resolution]
    ],
    box(stroke: 0.3pt + luma(210), radius: 2pt, inset: 5pt, fill: luma(252))[
      #text(8pt)[Context \ narration]
    ],
  )
]

#v(0.3em)

The LLM is useful inside a defined boundary. It handles semantic extraction, content generation, entity resolution, and context narration. It is not used as the canonical state store, the policy engine, the autonomy authority, or the sole predictor of business outcomes. Every LLM call has a token budget, a retry limit, and a template-based fallback. If the LLM is unavailable, the system continues operating. This boundary is one of the central design decisions. It is what separates a governed enterprise control plane from an LLM wrapper with connectors.

== Current product status

#v(0.2em)

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Status],
    text(fill: white, weight: "bold", size: 8.5pt)[Details],
  ),
  [#badge("Live", dark: true)],
  text(9pt)[
    Stripe world-model source (webhooks, typed events, canonical objects). Event ledger with hash-chained integrity. Object graph with customers, invoices, payments, disputes, relationships. State estimator with confidence intervals. Policy runtime with deterministic rule evaluation. Action gateway with evidence bundles. Earned autonomy with statistical promotion and demotion. Eight production dashboard views. 253 passing tests across unit, integration, contract, chaos, and load. Production infrastructure on Railway (PostgreSQL, Redis). Multi-provider LLM routing via OpenRouter.
  ],
  [#badge("Building")],
  text(9pt)[
    Multi-source connectors (Gmail, QuickBooks, CRM). Simulation engine for pre-execution scenario analysis. Closed-loop calibration feeding outcomes back to prediction models.
  ],
  [#badge("Target")],
  text(9pt)[
    Cross-domain cascade modeling. Domain pack SDK for third-party extensions. Causal inference models. Privacy-preserving transfer learning across tenants.
  ],
)

#v(0.2em)

The company is not presenting a speculative architecture as if it were already deployed. The live system today is deliberately narrow. The broader architecture described in this paper is the product direction the current wedge is designed to support.


// ============================================================
// 6. THE WORLD MODEL
// ============================================================

= The World Model

The world model is the core intellectual property. It is a persistent, calibrated representation of a company's operational state that enables prediction, governance, and eventually simulation.

== Observation layer

Connected business systems emit events ingested into the event ledger. Each event is typed, timestamped, hash-chained for integrity, and carries provenance metadata. Events transform deterministically into objects and relationships in the canonical object graph.

Today, Stripe is the live source. Webhooks for invoice creation, payment success and failure, dispute opening, and customer events are ingested and transformed into five canonical object types: Party, Invoice, Payment, Dispute, and Conversation.

== Belief and prediction layer

Not every important business fact is directly observable. The system maintains an estimated state layer for targets such as payment probability, dispute risk, urgency, and expected collection timing. Every estimate carries a value, a confidence interval, a model lineage, and a calibration trail. The guiding principle is clear separation between observed facts and inferred beliefs.

The estimation layer uses a progression of model complexity, promoted only when evidence justifies it:

+ *Rule-based heuristics:* interpretable, fast to deploy, default for new tenants
+ *Gradient-boosted statistical models:* XGBoost, logistic regression, deployed when calibration evidence accumulates
+ *Causal and intervention models:* target architecture, deployed as outcome data reaches sufficient volume

== Prediction targets (initial AR domain)

#v(0.2em)

#table(
  columns: (1fr, auto, auto),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Target],
    text(fill: white, weight: "bold", size: 8.5pt)[Type],
    text(fill: white, weight: "bold", size: 8.5pt)[Horizon],
  ),
  text(9pt)[Payment probability], text(9pt)[Float \[0,1\]], text(9pt)[7, 30, 90 days],
  text(9pt)[Days to payment], text(9pt)[Distribution], text(9pt)[Per invoice],
  text(9pt)[Churn risk], text(9pt)[Float \[0,1\]], text(9pt)[30, 90 days],
  text(9pt)[Dispute probability], text(9pt)[Float \[0,1\]], text(9pt)[Per invoice],
  text(9pt)[Customer lifetime value], text(9pt)[Distribution], text(9pt)[12 months],
  text(9pt)[DSO forecast], text(9pt)[Distribution], text(9pt)[30/60/90 days],
)

== Calibration and trust

Every prediction is stored with its eventual outcome. Calibration reports compare predicted probabilities against observed frequencies. A model that predicts 70% payment probability should see approximately 70% of those invoices paid. When calibration drifts beyond acceptable thresholds, the system flags the model for review and falls back to more conservative estimates. Users can inspect the system's track record for any prediction class and verify that its confidence claims are honest.

#v(0.4em)

#fig("Figure 3: World model pipeline (concrete example)")[
  #set text(8.5pt)
  #grid(
    columns: (1fr, 12pt, 1fr, 12pt, 1fr, 12pt, 1fr),
    gutter: 0pt,
    align: center + horizon,
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 7pt, width: 100%, fill: luma(248))[
      #text(7.5pt, weight: "bold", tracking: 0.3pt)[1. OBSERVE]
      #v(3pt)
      #text(8pt)[
        Stripe webhook: \
        `invoice.payment_failed` \
        \$4,200 from Acme Corp
      ]
    ],
    text(fill: luma(170))[#sym.arrow.r],
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 7pt, width: 100%, fill: luma(248))[
      #text(7.5pt, weight: "bold", tracking: 0.3pt)[2. MODEL]
      #v(3pt)
      #text(8pt)[
        Customer: Acme Corp \
        Invoice \#4821: overdue \
        3 open support tickets \
        Renewal in 9 days
      ]
    ],
    text(fill: luma(170))[#sym.arrow.r],
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 7pt, width: 100%, fill: luma(248))[
      #text(7.5pt, weight: "bold", tracking: 0.3pt)[3. ESTIMATE]
      #v(3pt)
      #text(8pt)[
        Payment prob: 0.34 \
        CI: \[0.22, 0.47\] \
        Churn risk: 0.71 \
        Model: xgb_v3
      ]
    ],
    text(fill: luma(170))[#sym.arrow.r],
    box(stroke: 0.8pt + luma(25), radius: 2pt, inset: 7pt, width: 100%, fill: luma(25))[
      #text(7.5pt, weight: "bold", fill: white, tracking: 0.3pt)[4. ACT]
      #v(3pt)
      #text(8pt, fill: luma(190))[
        Soft reminder \
        Personal tone \
        Evidence: tickets, \
        renewal context \
        Trust: Supervised
      ]
    ],
  )
]


// ============================================================
// 7. GOVERNED AUTONOMY
// ============================================================

= Governed Autonomy

Autonomy is not assigned globally. It is earned per action class from evidence. New action classes begin supervised. Promotion depends on repeated successful execution, procedural quality, business outcomes, and incident frequency. Demotion is immediate.

== Trust levels

#v(0.2em)

#table(
  columns: (auto, 1fr, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Level],
    text(fill: white, weight: "bold", size: 8.5pt)[Behavior],
    text(fill: white, weight: "bold", size: 8.5pt)[Promotion Criteria],
  ),
  text(9pt, weight: "bold")[Locked], text(9pt)[Action type forbidden], text(9pt)[Explicit policy enablement],
  text(9pt, weight: "bold")[Shadow], text(9pt)[System proposes, no user visibility], text(9pt)[Internal testing only],
  text(9pt, weight: "bold")[Supervised], text(9pt)[User approves each action], text(9pt)[Default for all new action types],
  text(9pt, weight: "bold")[Auto + Review], text(9pt)[Executes, user reviews after], text(9pt)[See thresholds below],
  text(9pt, weight: "bold")[Autonomous], text(9pt)[No human involvement], text(9pt)[See thresholds below],
)

== Promotion thresholds

*Supervised to Auto + Review* requires all of the following within a rolling 30-day window, evaluated per action class, per tenant:

- At least 20 completed executions
- Procedural score at or above 85%
- Outcome score at or above 75%
- At most 1 minor incident, 0 moderate or critical

*Auto + Review to Autonomous* requires all of the following within a rolling 60-day window:

- At least 50 completed executions
- Procedural score at or above 90%
- Outcome score at or above 80%
- Zero incidents of any severity

== Precise definitions

These terms support auditability and are used throughout the promotion criteria.

*Procedural score.* Did the action follow the policy template? Measured as the percentage of policy predicates that evaluated to true at execution time. An action that skipped a required check or deviated from the prescribed sequence scores lower. Binary per-predicate, averaged across the action.

*Outcome score.* Did the predicted result match the observed result? Measured as whether the actual outcome fell within the model's predicted confidence interval. A payment prediction of 0.70 \[0.55, 0.85\] where the invoice was paid scores 1.0. An invoice predicted at 0.70 that went to dispute scores 0.0. Averaged over the evaluation window.

*Incident.* Any of: (a) a customer complaint attributed to the action, (b) a constraint violation detected post-execution, or (c) an observed outcome outside 2-sigma of the model's prediction. Classified as minor (recoverable, no customer impact), moderate (customer-visible, recoverable), or critical (financial loss, relationship damage, or compliance violation).

== Asymmetric demotion

Promotion is slow. Demotion is immediate. A single moderate or critical incident triggers automatic demotion to Supervised for the affected action class. The system notifies the operator, provides a full evidence bundle, and resets the trust score. The cost of a false positive (unnecessary human review) is always lower than the cost of a false negative (unsupervised mistake).

== Sparse-data safeguards

In low-volume environments where 20 or 50 executions may take months to accumulate, the system does not promote. It remains Supervised and alerts the operator that insufficient data is available. There is no interpolation, no borrowed confidence from other tenants, and no default promotion schedule. Trust is earned from the tenant's own data or not at all.

#v(0.4em)

#fig("Figure 4: Autonomy progression")[
  #set text(8.5pt)
  #align(center)[
    #grid(
      columns: (auto, 12pt, auto, 12pt, auto, 12pt, auto, 12pt, auto),
      gutter: 0pt,
      align: center + horizon,
      box(stroke: 0.5pt + luma(190), radius: 2pt, inset: (x: 8pt, y: 6pt), fill: white)[
        #text(8pt, weight: "bold")[Locked]
      ],
      text(fill: luma(170))[#sym.arrow.r],
      box(stroke: 0.5pt + luma(190), radius: 2pt, inset: (x: 8pt, y: 6pt), fill: luma(248))[
        #text(8pt, weight: "bold")[Shadow]
      ],
      text(fill: luma(170))[#sym.arrow.r],
      box(stroke: 0.5pt + luma(160), radius: 2pt, inset: (x: 8pt, y: 6pt), fill: luma(238))[
        #text(8pt, weight: "bold")[Supervised]
      ],
      text(fill: luma(170))[#sym.arrow.r],
      box(stroke: 0.5pt + luma(130), radius: 2pt, inset: (x: 8pt, y: 6pt), fill: luma(218))[
        #text(8pt, weight: "bold")[Auto+Review]
      ],
      text(fill: luma(170))[#sym.arrow.r],
      box(stroke: 0.8pt + luma(25), radius: 2pt, inset: (x: 8pt, y: 6pt), fill: luma(25))[
        #text(8pt, weight: "bold", fill: white)[Autonomous]
      ],
    )
  ]
  #v(6pt)
  #align(center)[
    #text(8pt, fill: luma(110))[
      Promotion: weeks to months, evidence-required #h(20pt) Demotion: immediate on any qualifying incident
    ]
  ]
]


// ============================================================
// 8. PRODUCT WEDGE
// ============================================================

= The Initial Product Wedge: Stripe-First Accounts Receivable

The first product should solve one painful, measurable workflow exceptionally well. For Nooterra, that workflow is Stripe-first AR operations. This wedge is strategically strong for four reasons.

*The event stream is clean.* Stripe provides high-quality, typed, real-time events and widely adopted billing infrastructure. An accurate operational substrate can be built without reverse engineering.

*Outcomes are economically explicit.* Receivables performance is measured in dollars and days. Improvements are visible quickly. U.S. small businesses with unpaid invoices carry roughly \$17,500 in overdue receivables on average~[3]. Mid-market firms carry approximately \$304,000. Late payments regularly create payroll stress for SMBs~[4].

*The feedback loop is fast.* Payment outcomes, reply patterns, disputes, and approval behavior arrive quickly enough to produce meaningful action-outcome data. The business does not wait quarters to learn whether an action mattered.

*The user experience stays simple.* Connect Stripe. Review company state. Launch a governed collections runtime in shadow mode. Approve or reject real proposals. Let autonomy expand only when justified by evidence.

#v(0.3em)
#callout[
  #text(9.5pt)[
    *The wedge is narrow by design.* A narrow wedge is not a weakness. It is the mechanism by which the company validates the architecture, captures training signal, proves ROI, and earns the right to expand. The question is not whether Stripe-first receivables is the entire business. It is whether it is the fastest path to a validated world model and a meaningful action-outcome dataset. The answer is yes.
  ]
]


// ============================================================
// 9. GOVERNANCE AND SECURITY
// ============================================================

= Governance, Security, and Operational Trust

A system that proposes or executes business actions needs a stronger trust model than a typical application layer product.

*Tenant isolation.* World state, prediction history, approval records, and action evidence are tenant-scoped at the database level. Cross-tenant queries are architecturally impossible: the query layer enforces tenant scoping at the connection level, not the application level.

*Authentication and authorization.* User authentication through magic link (email OTP) and passkey-based flows, with no password storage. Authorization uses a Zanzibar-style directed acyclic graph. Each gateway action is checked against the authority graph before execution. Approval authority is explicit: only users with the appropriate grant can approve actions in a given class.

*Evidence and audit.* Every meaningful action produces a durable evidence bundle: proposed action, policy predicates evaluated, state estimates at decision time, approval decision, execution result, and observed outcome. Stored in the append-only event ledger with hash-chain integrity. Immutable. Retained for the lifetime of the tenant account.

*Incident handling.* Incidents demote trust immediately, surface evidence, and pause execution until human review. Critical incidents pause all autonomous actions for the tenant.

*Honest system boundaries.* Users can see which parts of the system are observed, which are estimated, which are governed by hard policy, and which are heuristic. Overstating capability destroys trust faster than a conservative system ever will.


// ============================================================
// 10. MARKET OPPORTUNITY
// ============================================================

= Market Opportunity

== TAM / SAM / SOM

#v(0.2em)

#table(
  columns: (auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[],
    text(fill: white, weight: "bold", size: 8.5pt)[Size],
    text(fill: white, weight: "bold", size: 8.5pt)[Definition],
  ),
  text(9pt, weight: "bold")[TAM], text(9pt)[\$47B], text(9pt)[Global enterprise AI operations and AR automation spend],
  text(9pt, weight: "bold")[SAM], text(9pt)[\$8.2B], text(9pt)[B2B companies using Stripe, QuickBooks, or modern billing infrastructure with AR pain],
  text(9pt, weight: "bold")[SOM (Year 3)], text(9pt)[\$12M ARR], text(9pt)[1,000 SMB/mid-market customers across Starter, Business, and Finance Ops tiers],
)

== Why AR is the right starting market

AR collections is not the entire opportunity. It is the fastest path to a production-validated world model. Every B2B company does AR. Late payments are universal and expensive. The buyer is a founder or finance lead who can make purchase decisions quickly, without enterprise procurement cycles. And the success metric (did cash arrive faster?) is unambiguous.

== Unit economics

#v(0.2em)

#table(
  columns: (1fr, auto),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Metric],
    text(fill: white, weight: "bold", size: 8.5pt)[Value],
  ),
  text(9pt)[LLM cost per customer (blended)], text(9pt)[~\$50/month],
  text(9pt)[Infrastructure cost per customer], text(9pt)[~\$15/month],
  text(9pt)[Blended ARPU target (Year 2)], text(9pt)[\$300/month],
  text(9pt)[Gross margin at Business tier (\$499/mo)], text(9pt)[~87%],
  text(9pt)[Gross margin at Starter tier (\$149/mo)], text(9pt)[~56%],
)


// ============================================================
// 11. COMPETITIVE POSITION
// ============================================================

= Competitive Position and Durable Moats

The strongest objection to this category: if the need is real, why will horizontal platform companies not absorb it?

The objection is important. Foundation model companies and horizontal agent platforms will continue improving the shared substrate. Better orchestration, memory, tool use, connectors, safety layers, reasoning. Nooterra should assume that happens.

That does not eliminate the category. It clarifies where enduring value sits.

#v(0.3em)

#table(
  columns: (auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Category],
    text(fill: white, weight: "bold", size: 8.5pt)[Examples],
    text(fill: white, weight: "bold", size: 8.5pt)[Gap],
  ),
  text(9pt)[AI Agent Frameworks], text(9pt)[CrewAI, AutoGen, LangGraph], text(9pt)[No world model, no governance, no persistent state. Developer tooling, not a product.],
  text(9pt)[Vertical AR Tools], text(9pt)[Tesorio, Upflow, Bill.com], text(9pt)[Timer-based reminders. No state estimation, no cross-domain awareness, no earned autonomy.],
  text(9pt)[Workflow Automation], text(9pt)[Zapier, Make, n8n], text(9pt)[Task execution without dynamics understanding. No simulation, no governance.],
  text(9pt)[Foundation Model Cos.], text(9pt)[Anthropic, OpenAI, Google], text(9pt)[Horizontal platforms selling APIs. Vertical domain runtimes require data they do not have.],
)

#v(0.3em)

== On the platform company threat

The honest answer: foundation model companies could build a general-purpose state-tracking layer. But the value in Nooterra is not the state-tracking layer. It is the calibrated prediction models trained on proprietary action-outcome data, the domain-specific policy engines, and the tenant-level earned autonomy histories that accumulate over months of production use. These are vertical data flywheels, not features. Foundation model companies are building horizontal platforms. Nooterra builds the vertical intelligence layer on top. We use their APIs. We are not competing for the same budget.

== Defensible advantages

*Proprietary action-outcome data.* Every tenant's approvals, rejections, outcomes, and incidents become training signal. This data does not exist in any public dataset.

*Trust lock-in.* Once a company has spent months training autonomy levels, building custom policies, and calibrating predictions, switching means starting at zero. Trust histories cannot be exported.

*Engineering head start.* Event ledger, object graph, state estimator, policy runtime, and autonomy engine represent 12 to 18 months of infrastructure engineering. The first team to ship it with a working product has a durable structural advantage.

*Cross-domain compounding.* Each new data source increases the value of every existing source. AR, support, and CRM in a unified world model sees patterns no single-domain tool can see.


// ============================================================
// 12. COMMERCIAL MODEL
// ============================================================

= Commercial Model

Customers do not care how many tokens were consumed. They care whether cash arrived faster, bad actions were prevented, and their team spent less time triaging. Nooterra prices on governed business value, not compute.

#v(0.2em)

#table(
  columns: (auto, auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Tier],
    text(fill: white, weight: "bold", size: 8.5pt)[Price],
    text(fill: white, weight: "bold", size: 8.5pt)[Target],
    text(fill: white, weight: "bold", size: 8.5pt)[Key Features],
  ),
  text(9pt)[Sandbox], text(9pt)[Free], text(9pt)[Evaluation], text(9pt)[1 Stripe account, shadow mode, time-boxed],
  text(9pt)[Starter], text(9pt)[\$149/mo], text(9pt)[Founder-led SMBs], text(9pt)[1 agent, Stripe world model, approval queue, predictions],
  text(9pt)[Business], text(9pt)[\$499/mo], text(9pt)[Growing businesses], text(9pt)[Full autonomy, multiple runtimes, Slack approvals],
  text(9pt)[Finance Ops], text(9pt)[\$799--1,500/mo], text(9pt)[Finance teams], text(9pt)[Multi-user, audit/export, custom policies, premium support],
  text(9pt)[Enterprise], text(9pt)[Custom], text(9pt)[Mid-market+], text(9pt)[Multi-system, SSO/SCIM, custom connectors, SLA],
)

== Go-to-market

*Months 1--6:* Design partner pilots. Hand-selected B2B service companies. Free access in exchange for weekly feedback. Goal: 5--10 partners, measurable DSO reduction.

*Months 4--8:* Invite-only launch. 50 companies from waitlist. Paid Starter and Business tiers. Content marketing with partner case studies.

*Months 7--12:* Open access. Self-serve sandbox trial. Bookkeeper and accountant referral program.


// ============================================================
// 13. ROADMAP
// ============================================================

= Roadmap: From Wedge to Platform

The expansion sequence compounds data advantages at each stage. Each phase builds on the operational trust earned in the previous one.

#v(0.2em)

#table(
  columns: (auto, auto, 1fr, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Phase],
    text(fill: white, weight: "bold", size: 8.5pt)[Timeline],
    text(fill: white, weight: "bold", size: 8.5pt)[Milestone],
    text(fill: white, weight: "bold", size: 8.5pt)[Success Metric],
  ),
  text(9pt)[AR Wedge], text(9pt)[Months 1--6], text(9pt)[Stripe world model. Shadow collections. Governed actions. Earned autonomy.], text(9pt)[5--10 design partners. Measurable DSO reduction.],
  text(9pt)[Finance Control Plane], text(9pt)[Months 7--12], text(9pt)[Disputes, refunds, cash forecasting. Multi-source state (Gmail, QuickBooks). Simulation v1.], text(9pt)[200 paying customers. First case studies.],
  text(9pt)[Multi-Domain Platform], text(9pt)[Months 13--24], text(9pt)[CRM integration. Cross-domain relationships. Domain pack architecture. Support ops.], text(9pt)[1,000+ customers. Enterprise deals.],
)

#v(0.3em)

Later expansion into support, revenue operations, and procurement follows the same pattern. Each domain is added only when the platform infrastructure has been validated in the previous domain. Expansion is earned, not declared by slideware.


// ============================================================
// 14. TEAM
// ============================================================

= Team

#callout[
  #text(9pt, fill: luma(80))[
    _This section should include: 2--3 sentences on the founding insight (what did you see that others missed?), founder bios with relevant background, and 2--3 key hires planned. Investors weight team heavily at pre-seed/seed. Fill this in with your actual details._
  ]
]


// ============================================================
// 15. THE ASK
// ============================================================

= The Ask

#callout[
  #text(9pt, fill: luma(80))[
    _Specify: round type (pre-seed/seed), amount, use of proceeds (engineering %, GTM %, infrastructure %), and the milestones this capital funds. Include a table mapping capital to months 6, 12, and 18 milestones._
  ]
]


// ============================================================
// CLOSING
// ============================================================

#v(1.5em)
#line(length: 100%, stroke: 0.3pt + luma(210))
#v(0.8em)

#align(center)[
  #text(10pt, weight: "bold", tracking: 5pt, fill: luma(120))[NOOTERRA]

  #v(0.15em)

  #text(9.5pt, fill: luma(90))[
    Enterprise World Model Platform \
    nooterra.ai
  ]

  #v(0.2em)

  #text(8.5pt, fill: luma(150))[
    April 2026. Confidential.
  ]
]


// ============================================================
// REFERENCES
// ============================================================

#v(1em)
#text(8pt, fill: luma(100))[
  *References*

  \[1\] Gupta, Li, Liu, Subramanian, Suleman, Zhang, Lu, Pasupalak. "World of Workflows: A Benchmark for Bringing World Models to Enterprise Systems." arXiv:2601.22130. January 2026. \
  \[2\] Stripe. "Stripe powers more than 5 million businesses directly or via platforms." Stripe newsroom, February 2026. \
  \[3\] QuickBooks. "Late Payments Report 2025." May 2025. \
  \[4\] Bluevine. "The late payment gap survey." March 2026.
]
