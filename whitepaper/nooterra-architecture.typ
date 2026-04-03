// ============================================================
// NOOTERRA ARCHITECTURE — Due Diligence Package
// Monochrome. For technical evaluators under NDA.
// ============================================================

#set document(
  title: "Nooterra: System Architecture",
  author: "Nooterra, Inc.",
  date: datetime(year: 2026, month: 4, day: 1),
)

#set page(
  paper: "us-letter",
  margin: (top: 1.1in, bottom: 1in, left: 1in, right: 1in),
  header: context {
    if counter(page).get().first() > 1 [
      #set text(7.5pt, fill: luma(150), tracking: 1.5pt)
      NOOTERRA #h(1fr) #text(tracking: 0pt)[System Architecture]
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
  leading: 0.68em,
  justify: true,
)

#set heading(numbering: "1.")

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  v(0.6em)
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

// --- Utilities ---

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

#let code-block(body) = {
  block(
    width: 100%,
    fill: luma(248),
    stroke: 0.4pt + luma(210),
    radius: 3pt,
    inset: 10pt,
    text(8.5pt, font: "Menlo", body),
  )
}

#let current-label = badge("Live", dark: true)
#let building-label = badge("Building")
#let target-label = badge("Target")


// ============================================================
// COVER
// ============================================================

#page(header: none, footer: none)[
  #v(2in)

  #text(10pt, weight: "bold", tracking: 5pt, fill: luma(120))[NOOTERRA]

  #v(0.4in)

  #text(26pt, weight: "bold", tracking: -0.3pt)[System Architecture]

  #v(0.15in)

  #block(width: 85%)[
    #text(11pt, fill: luma(70))[
      Technical due diligence package. \
      Current implementation, target architecture, and research roadmap \
      for the enterprise world model platform.
    ]
  ]

  #v(1.8in)

  #text(9.5pt, fill: luma(130))[
    Confidential. Shared under NDA. \
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
// 1. SYSTEM OVERVIEW
// ============================================================

= System Overview

Nooterra is an enterprise world model platform. It ingests events from connected business systems, constructs a canonical representation of company state, estimates hidden operational variables, evaluates policy constraints, and governs agent actions through an evidence-based autonomy framework.

The platform is a hybrid system. The language model is a bounded reasoning component within a larger operational architecture. It is not the system of record, the policy authority, or the source of trust.

== Subsystem maturity

#v(0.2em)

#table(
  columns: (auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Subsystem],
    text(fill: white, weight: "bold", size: 8.5pt)[Status],
    text(fill: white, weight: "bold", size: 8.5pt)[Details],
  ),
  text(9pt)[Event Ledger], [#current-label], text(9pt)[Append-only, hash-chained, bi-temporal. PostgreSQL.],
  text(9pt)[Object Graph], [#current-label], text(9pt)[5 canonical types. Typed relationships, version history, provenance.],
  text(9pt)[State Estimator], [#current-label], text(9pt)[Rule-based + logistic regression. Confidence scoring. Conflict detection.],
  text(9pt)[Policy Runtime], [#current-label], text(9pt)[Zanzibar-style DAG. Deterministic guards. LLM judgments with fallback.],
  text(9pt)[Action Gateway], [#current-label], text(9pt)[11-step pipeline. Evidence bundles. Reversibility tracking.],
  text(9pt)[Autonomy Engine], [#current-label], text(9pt)[Per-action-class trust levels. Procedural + outcome scoring. Asymmetric demotion.],
  text(9pt)[Stripe Connector], [#current-label], text(9pt)[Webhook ingestion. Typed WorldEvents. 5 canonical object types.],
  text(9pt)[Multi-Source Connectors], [#building-label], text(9pt)[Gmail, QuickBooks, CRM. Framework in place, connectors in development.],
  text(9pt)[Simulation Layer], [#building-label], text(9pt)[Rule-based scenario analysis. Causal simulation in design.],
  text(9pt)[Conformal Prediction], [#target-label], text(9pt)[MAPIE integration for statistically guaranteed prediction intervals.],
  text(9pt)[Causal Inference], [#target-label], text(9pt)[DoWhy + EconML for treatment effect estimation. CausalNex for simulation.],
  text(9pt)[Inter-Company Network], [#target-label], text(9pt)[Agent identity, capability discovery, negotiation protocol.],
)

== Tech stack

- *Runtime:* TypeScript (strict mode), Node.js
- *Database:* PostgreSQL (Railway), Redis (optional caching)
- *LLM routing:* OpenRouter (OpenAI, Anthropic, Google)
- *Integrations:* Composio (250+ app connectors), Stripe API (direct)
- *Infrastructure:* Railway (production), Docker Compose (local), Helm charts (Kubernetes)
- *Auth:* Magic link (email OTP) + passkeys. No password storage.
- *Testing:* 253 tests across unit, integration, contract, chaos, and load categories. 0 failures.

#v(0.4em)

#fig("Figure 1: Platform architecture")[
  #set text(8.5pt)
  #v(2pt)

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

  #text(7.5pt, fill: luma(100), weight: "bold", tracking: 0.5pt)[CORE PLATFORM]
  #v(4pt)
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 5pt,
    sysbox("Event Ledger", "Append-only, hash-chained, bi-temporal"),
    sysbox("Object Graph", "Typed entities, relationships, provenance"),
    sysbox("State Estimator", "Beliefs, confidence, calibration"),
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


// ============================================================
// 2. EVENT LEDGER
// ============================================================

= Event Ledger

The event ledger is the audit foundation of the system. Every observation, action, and state change is recorded as an immutable, append-only event.

== Current implementation #current-label

Events are stored in a PostgreSQL table partitioned by tenant and time. Each event carries:

- *Type:* A hierarchical event type (e.g., `financial.invoice.created`, `financial.payment.received`, `relationship.party.created`)
- *Timestamps:* Bi-temporal. `timestamp` records when the event happened in the real world. `recordedAt` records when the system learned about it. This distinction is critical for late-arriving data: an invoice dated March 1 but received April 15 must be recorded with both times.
- *Hash chain:* Each event stores a content hash and the previous event's hash per tenant. Chain breaks are detectable. This provides tamper-evidence without requiring blockchain infrastructure.
- *Provenance:* `sourceSystem` (stripe, gmail, etc.), `sourceId` (ID in the original system), `extractionMethod` (api, llm, rule, human), `extractionConfidence` (0 to 1), `rawRef` (reference to the raw source event before extraction).
- *Immutability:* Events are never mutated. Corrections create new events with a `causedBy` reference to the original. The system can reconstruct any historical state by replaying events up to a given timestamp.

#v(0.3em)

#fig("Figure 2: Event flow from Stripe webhook to ledger")[
  #set text(8.5pt)
  #grid(
    columns: (1fr, 12pt, 1fr, 12pt, 1fr),
    gutter: 0pt,
    align: center + horizon,
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 7pt, width: 100%, fill: luma(248))[
      #text(7.5pt, weight: "bold")[RAW WEBHOOK]
      #v(3pt)
      #text(8pt)[
        `invoice.payment_failed` \
        Stripe event ID: `evt_1P...` \
        Customer: `cus_Acme` \
        Amount: \$4,200 \
        Timestamp: 2026-03-28T14:22Z
      ]
    ],
    text(fill: luma(170))[#sym.arrow.r],
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 7pt, width: 100%, fill: luma(248))[
      #text(7.5pt, weight: "bold")[CONNECTOR]
      #v(3pt)
      #text(8pt)[
        Normalize to SourceEvent \
        Extract entities (rule-based) \
        Resolve: `cus_Acme` -> Party #42 \
        Confidence: 1.0 (API field)
      ]
    ],
    text(fill: luma(170))[#sym.arrow.r],
    box(stroke: 0.8pt + luma(25), radius: 2pt, inset: 7pt, width: 100%, fill: luma(25))[
      #text(7.5pt, weight: "bold", fill: white)[LEDGER EVENT]
      #v(3pt)
      #text(8pt, fill: luma(190))[
        Type: `financial.payment.failed` \
        tenantId: `t_7f3a...` \
        objectRefs: [Invoice #4821] \
        prevHash: `a4f2c1...` \
        contentHash: `8b3e17...`
      ]
    ],
  )
]

#v(0.3em)

== Target state #target-label

- *Full bi-temporal queries:* "What did the system believe about Customer X on March 15?" requires querying both assertion time (when the belief was current) and transaction time (when the system recorded it). The schema supports this; the query interface is in development.
- *Content-addressed event references:* Cross-tenant audit without data sharing. A tenant can prove an event existed at a given time by providing its content hash without revealing the event contents.


// ============================================================
// 3. CANONICAL OBJECT GRAPH
// ============================================================

= Canonical Object Graph

The object graph is the core representation of company state. It transforms raw source records into canonical business objects with typed relationships, version history, and provenance tracking.

== Current implementation #current-label

Five canonical object types for the initial AR domain:

#table(
  columns: (auto, 1fr, auto),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Object Type],
    text(fill: white, weight: "bold", size: 8.5pt)[Description],
    text(fill: white, weight: "bold", size: 8.5pt)[Source],
  ),
  text(9pt, weight: "bold")[Party], text(9pt)[Customer or counterparty. Name, email, identifiers, metadata.], text(9pt)[Stripe],
  text(9pt, weight: "bold")[Invoice], text(9pt)[Billing document. Amount, status, due date, line items.], text(9pt)[Stripe],
  text(9pt, weight: "bold")[Payment], text(9pt)[Money movement. Amount, method, settlement status.], text(9pt)[Stripe],
  text(9pt, weight: "bold")[Dispute], text(9pt)[Chargeback or complaint. Reason, evidence deadline, status.], text(9pt)[Stripe],
  text(9pt, weight: "bold")[Conversation], text(9pt)[Communication thread. Messages, participants, sentiment.], text(9pt)[Gmail (target)],
)

Each object carries:

- *Version history:* Every mutation creates a new version. Previous versions are retained. The system can reconstruct object state at any historical point.
- *Provenance per field:* Each field records which source system provided the value, with extraction confidence. When multiple sources report the same field, the system tracks all contributions.
- *Temporal validity:* `valid_from` and `valid_to` timestamps for temporal queries.
- *Relationships:* Typed edges between objects (e.g., Party OWES Invoice, Payment SETTLES Invoice, Dispute CHALLENGES Payment). Relationships are first-class objects with their own version history.
- *Entity resolution:* When multiple sources reference the same real-world entity (e.g., "Acme Corp" in Stripe and "ACME Corporation" in QuickBooks), the system resolves them to a single canonical object with provenance from both sources.

== Target state #target-label

- *20+ object types:* Deal, Contract, Obligation, Task, ScheduleSlot, Document, and others as domain packs expand.
- *Temporal knowledge graph embeddings:* TTransE and TNTComplEx embed entities, relations, and timestamps into the same vector space. This enables link prediction: "Based on temporal patterns, Customer X is likely to churn within 30 days" or "Vendor Y is likely to submit an invoice next week." These are research-stage techniques (see Cai et al., 2024 for a survey of temporal KG methods).
- *Full bi-temporality:* Assertion time (when the fact was true in reality) plus transaction time (when the system recorded it), enabling historical replay for audit and debugging.


// ============================================================
// 4. STATE ESTIMATOR AND BELIEF SYSTEM
// ============================================================

= State Estimator and Belief System

Not every important business fact is directly observable. The state estimator maintains an estimated state layer that separates observed facts from inferred beliefs.

== Current implementation #current-label

The core abstraction is the *Belief*: an estimated fact with explicit uncertainty.

#code-block[
  interface Belief \{ \
  #h(12pt) field: string \
  #h(12pt) value: unknown \
  #h(12pt) confidence: number  // 0 to 1 \
  #h(12pt) sources: SourceContribution[] \
  #h(12pt) estimatedAt: Date \
  #h(12pt) method: 'direct_observation' | 'inference' \
  #h(24pt)       | 'aggregation' | 'default' \
  \}
]

Four estimation methods, applied in order of preference:

+ *Direct observation aggregation.* Multiple sources report the same field. The system uses recency and source reliability weighting. A Stripe API field (confidence 1.0) outweighs an LLM-extracted email field (confidence 0.7).

+ *Rule-based inference.* Deterministic rules derive beliefs from observable data. Example: invoice overdue 30+ days with no response to 2 emails implies payment probability drops below 0.4.

+ *Learned inference.* Statistical models trained on historical data. Logistic regression and XGBoost for payment propensity, churn risk, response likelihood, and dispute probability. Each model tracked independently with its own calibration history.

+ *Default priors.* When no data exists for a specific entity, the system uses industry and segment priors. These are explicitly labeled as low-confidence defaults.

*Conflict detection.* When multiple sources report different values for the same field, the system creates a first-class Conflict object. Simple field conflicts auto-resolve (newer observation wins). Complex conflicts surface for human resolution. All conflicts are logged for audit.

*Calibration tracking.* The CalibrationTracker computes MAE (Mean Absolute Error) per model per prediction target. Every prediction is stored alongside its eventual outcome. Calibration reports compare predicted probabilities against observed frequencies.

== Precise definitions

These terms are used throughout the system and are defined here for auditability:

- *Confidence:* The model's estimate of its own certainty for a specific prediction (0 to 1). A confidence of 0.85 means the model estimates an 85% chance its prediction is correct.
- *Calibration:* How well historical confidence estimates matched actual outcomes. A well-calibrated model with confidence 0.70 should see approximately 70% of those predictions come true. Measured as 1 minus MAE between predicted probabilities and observed frequencies.
- *Belief:* An estimated fact with a value, confidence, provenance chain (which sources contributed), estimation method, and timestamp. Beliefs are mutable; they update as new evidence arrives. Historical beliefs are preserved via version history.
- *Conflict:* When two or more sources report different values for the same field on the same object. Conflicts are first-class objects with resolution metadata.

== Target state #target-label

=== Conformal prediction (MAPIE)

The current system outputs point estimates with scalar confidence. The target state uses conformal prediction via the MAPIE library to produce statistically guaranteed prediction intervals.

Instead of "payment probability: 0.72, confidence: 0.6", the system will output "payment probability: 0.72, 90% prediction interval: [0.58, 0.86]." The interval carries a finite-sample coverage guarantee: regardless of the underlying model quality, the true value will fall within the interval at least 90% of the time.

For time series predictions (days to payment, DSO forecasts), the system will use the EnbPI (Ensemble batch Prediction Intervals) variant, which drops the exchangeability requirement that standard conformal methods assume.

Implementation path: MAPIE is pip-installable and wraps existing sklearn-compatible models. A Python sidecar service receives prediction requests and returns intervals. This is deployable in weeks.

=== Post-hoc calibration

Two complementary approaches:

- *Temperature scaling* (Guo et al., 2017): a single learned parameter T that rescales model outputs before softmax. Surprisingly effective on overconfident models. Fit by minimizing negative log-likelihood on a held-out calibration set.
- *Isotonic regression:* a non-parametric calibration method that fits a monotonic step function. More flexible than Platt scaling. Available in scikit-learn.

The system will use whichever method produces lower Expected Calibration Error (ECE) on holdout data for each prediction target.

=== Drift detection (ADWIN)

ADWIN (ADaptive WINdowing), via the River library for online machine learning, monitors prediction residuals (predicted minus actual) per model per tenant. It maintains a variable-length window and detects statistically significant distribution changes. When drift is detected, the system:

+ Flags the affected model for review
+ Widens prediction intervals automatically
+ Triggers recalibration or retraining if drift persists

Implementation: one class from the River library, approximately 5 lines of integration code per model. Runs as a streaming monitor on the prediction-outcome pair stream.

=== Out-of-distribution detection

Feature distribution monitoring via KL divergence. The system tracks the distribution of input features at training time. At inference time, it computes KL divergence between the current input distribution and the training distribution. When divergence exceeds a threshold, the system:

+ Flags predictions as low-confidence regardless of model output
+ Alerts the operator that the model is operating outside its training distribution
+ Falls back to more conservative (wider interval, lower autonomy) behavior

Conformal p-values provide a second OOD signal for free from the MAPIE infrastructure: data points with nonconformity scores above the calibration quantile are flagged as potentially out-of-distribution.


// ============================================================
// 5. WORLD MODEL ENSEMBLE
// ============================================================

= World Model Ensemble

The world model is not a single monolithic model. Each prediction target gets its own model instance. Models are independent, testable, and replaceable. The ensemble combines four model types, deployed in a progression based on data availability and calibration evidence.

== Current implementation #current-label

=== Model Type 1: Deterministic rules

Accounting identities, contract terms, deadline calculations, permission checks, budget arithmetic. These are always correct when their preconditions hold.

Example: "If invoice.dueAt < now AND invoice.status = 'sent', then invoice.status = 'overdue'."

=== Model Type 2: Probabilistic sequence models

Logistic regression and XGBoost trained on historical event sequences per object type. Prediction targets for the initial AR domain:

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

Each prediction is logged as a `system.model.prediction` event in the ledger, stored alongside its eventual outcome for calibration.

=== Model Type 3: Intervention estimates (current: heuristic)

The current implementation uses hardcoded heuristics to estimate the effect of actions. For example, sending a collection email is estimated to improve payment probability by 0.15. These are initial approximations that will be replaced by causal inference (see target state below).

=== Model Type 4: Scenario analysis (current: rule-based)

Rule-based scenario analysis for simple what-if questions. "What happens to DSO if we shorten payment terms from 30 to 15 days?" Answered by applying deterministic rules forward from the proposed change.

== Model lifecycle

+ *Training data:* Historical events from the ledger, joined with observed outcomes
+ *Feature engineering:* Object graph attributes, temporal features (days since last contact, payment velocity), relationship features (open tickets, renewal proximity)
+ *Training:* Standard sklearn/XGBoost pipeline
+ *Calibration testing:* ECE on holdout set. Models with ECE above threshold are rejected.
+ *Shadow deployment:* Model runs in parallel with production. Predictions logged but not used for decisions. Shadow period: minimum 14 days.
+ *Live deployment:* Model replaces the previous version. Continuous calibration monitoring.
+ *Retraining triggers:* ADWIN drift detection (target state), calibration degradation, or manual review.

== Target state #target-label

=== Causal inference via DoWhy + EconML

The highest-leverage upgrade to the world model. Replaces hardcoded intervention heuristics with Conditional Average Treatment Effects (CATE).

*DoWhy* (Microsoft/PyWhy) provides a 4-step causal inference API:
+ *Model:* Specify the causal graph (DAG) relating actions, confounders, and outcomes
+ *Identify:* Find the valid adjustment set for the desired causal effect
+ *Estimate:* Compute the effect using Double ML, causal forests, or instrumental variables
+ *Refute:* Test sensitivity to assumptions (placebo treatment, random common cause, data subset)

*EconML* provides the estimators. Causal forests (Athey & Wager, 2018) estimate heterogeneous treatment effects: different customers respond differently to the same action. Instead of "sending a collection email improves payment probability by 0.15" (a global average that may be wrong for any individual customer), the system will output "sending a collection email to THIS customer with THIS payment history increases payment probability by 0.22 +/- 0.08."

Implementation: Python sidecar service. Ingests the `world_predictions` and `world_prediction_outcomes` tables. Outputs per-customer CATE estimates with confidence intervals. The existing `estimateIntervention()` function becomes a thin client to this service.

=== Causal discovery via NOTEARS + PC algorithm

Before estimating causal effects, the system needs a causal graph. Two approaches:

- *PC algorithm:* Uses conditional independence tests to learn the DAG structure from observational data. Fast, well-understood, available in the `causal-learn` library.
- *NOTEARS:* Reformulates DAG learning as a continuous optimization problem with an acyclicity constraint. More scalable than PC but has known issues with scale-invariance on dimensional quantities (see Kaiser & Sipos, 2025).

The system will use PC for initial structure learning, validate with domain experts, and refine incrementally as more data accumulates.

=== Simulation via CausalNex

CausalNex (McKinsey/QuantumBlack) builds Bayesian networks from data and expert knowledge, then supports do-calculus interventions.

Replace: `Math.min(1, currentPayProb + 0.15)` \
With: `bn.do(intervention=\{'sent_email': 1\}).query('payment_7d')` \
Returns: an actual posterior distribution, not a magic number.

=== Monte Carlo rollout with causal constraints

Once the causal DAG is in place, the system can sample from the joint distribution implied by the graph, respecting causal ordering. Interventions propagate forward through time. Output: "If we change collections cadence, here are 1,000 simulated futures with confidence bands on revenue, churn, and support load."

This is the full realization of the simulation layer: scenario cards with predicted impact, confidence intervals, tradeoffs, key assumptions, and known unknowns.


// ============================================================
// 6. POLICY AND AUTHORITY ENGINE
// ============================================================

= Policy and Authority Engine

The policy engine decides what is allowed. It evaluates deterministic rules over the canonical object graph. It is separate from the LLM reasoning layer by design.

== Current implementation #current-label

=== Authority graph

A directed acyclic graph (DAG) modeled after Google's Zanzibar authorization system. Humans grant authority to agents. Agents can delegate to sub-agents. Every edge is an AuthorityGrant with explicit scope:

- *Action classes:* Which types of actions can be taken (e.g., `send_collection_email`, `issue_refund`)
- *Object types:* Which object types can be acted upon
- *Party filters:* Which counterparties (e.g., "only customers with LTV > \$10K")
- *Budget limits:* Maximum value per action and per time window
- *Time windows:* When actions are permitted
- *Jurisdiction:* Geographic or regulatory scope

Authority only attenuates. A child's authority is always a subset of its parent's. This is enforced structurally: the grant evaluation function intersects the parent's scope with the child's requested scope.

=== Policy guards

Deterministic, fast, auditable rules that evaluate to allow, deny, or require_approval.

#code-block[
  interface PolicyGuard \{ \
  #h(12pt) id: string \
  #h(12pt) description: string \
  #h(12pt) condition: PolicyPredicate \
  #h(12pt) effect: 'allow' | 'deny' | 'require_approval' \
  #h(12pt) priority: number \
  \}
]

Guards are evaluated in priority order. The first matching guard determines the outcome. If no guard matches, the system defaults to `require_approval`.

=== Policy judgments

For ambiguous cases where deterministic rules are insufficient, the system evaluates an LLM-based judgment. Each judgment has a trigger condition, an evaluation prompt, a fallback decision (used if the LLM times out or fails), and a timeout.

Judgments are secondary to guards. Guards are always evaluated first. Judgments are only reached when no guard produces a definitive answer.

=== neverDo lists

Actions that are categorically forbidden. These lists are immutable from autonomous code paths. Only human operators can modify them. Examples: "Never issue a refund exceeding the original invoice amount." "Never contact a customer flagged as legally represented."

=== Authorization decision flow

#fig("Figure 3: Authorization pipeline")[
  #set text(8.5pt)
  #stack(
    dir: ttb,
    spacing: 3pt,
    block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
      1. Extract from proposed action: action class, target objects, counterparties, value, timing
    ],
    block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
      2. Load agent's effective authority (all grants merged via intersection)
    ],
    block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
      3. Check neverDo list. DENY if match.
    ],
    block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
      4. Check scope: object type, party filter, budget, jurisdiction, time. DENY if out of scope.
    ],
    block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
      5. Evaluate deterministic guards in priority order. ALLOW / DENY / REQUIRE_APPROVAL.
    ],
    block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
      6. If no guard matched: evaluate LLM-based judgments (with fallback and timeout).
    ],
    block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
      7. If still no decision: default to REQUIRE_APPROVAL.
    ],
    block(fill: luma(25), inset: 7pt, radius: 2pt, width: 100%)[
      #text(fill: white)[8. If ALLOW: check rate limits and budget (atomic). Execute. If REQUIRE_APPROVAL: queue for human.]
    ],
  )
  #v(4pt)
  #text(8pt, fill: luma(110))[Every decision is logged with full reasoning chain for audit.]
]

== Target state #target-label

=== LLM-to-formal-policy compilation

The PolicyEditor UI lets humans write policies in natural language. The target state compiles these into executable symbolic constraints with soundness verification. Recent work on neurosymbolic verification achieves 99%+ soundness on policy-to-formal translations (see Cosler et al., 2023).

Example: "Never send more than 2 collection emails per week per customer" compiles to a deterministic guard with a rate-limit predicate and per-customer, per-week windowing.

=== Neurosymbolic guard evaluation

Every LLM-proposed action passes through a symbolic constraint checker that evaluates the action against the object graph invariants and the policy engine. This catches structurally invalid proposals ("refund larger than invoice," "contact legally represented customer") before they reach the gateway.


// ============================================================
// 7. ACTION GATEWAY
// ============================================================

= Action Gateway

The gateway is the single chokepoint for all side effects. Every action that touches the external world passes through an 11-step pipeline.

== Current implementation #current-label

#table(
  columns: (auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Step],
    text(fill: white, weight: "bold", size: 8.5pt)[Name],
    text(fill: white, weight: "bold", size: 8.5pt)[Function],
  ),
  text(9pt)[1], text(9pt, weight: "bold")[Authenticate], text(9pt)[Verify agent identity and authority grant chain],
  text(9pt)[2], text(9pt, weight: "bold")[Authorize], text(9pt)[Evaluate against policy and authority engine (Section 6)],
  text(9pt)[3], text(9pt, weight: "bold")[Validate], text(9pt)[Check parameters, counterparty, value limits],
  text(9pt)[4], text(9pt, weight: "bold")[Rate Limit], text(9pt)[Enforce action frequency limits per class per tenant],
  text(9pt)[5], text(9pt, weight: "bold")[Budget Check], text(9pt)[Verify budget available, atomic decrement],
  text(9pt)[6], text(9pt, weight: "bold")[Disclosure], text(9pt)[Inject required disclosures (e.g., "AI composed this message")],
  text(9pt)[7], text(9pt, weight: "bold")[Simulate], text(9pt)[Optional. World model predicts downstream effects. Escalate if negative.],
  text(9pt)[8], text(9pt, weight: "bold")[Escrow], text(9pt)[Low risk: execute. Medium: hold. High: hold and notify human.],
  text(9pt)[9], text(9pt, weight: "bold")[Execute], text(9pt)[Call tool or integration. Capture result. Record compensating action.],
  text(9pt)[10], text(9pt, weight: "bold")[Audit], text(9pt)[Write event to ledger. Generate evidence bundle. Update object graph.],
  text(9pt)[11], text(9pt, weight: "bold")[Notify], text(9pt)[Trigger state estimator, evaluator, and planner updates.],
)

=== Evidence bundles

Every executed action produces a mandatory evidence bundle containing: the proposed action, the policy predicates evaluated, the facts relied on (with object IDs), the tools used, the agent's self-assessed uncertainty, the approval decision (human or automatic), the execution result, the reversible path (how to undo), and the authority chain.

Evidence bundles are stored in the append-only event ledger with hash-chain integrity. They are immutable and retained for the lifetime of the tenant account.

=== Reversibility tracking

Each action class is annotated with reversibility metadata: full (can be completely undone), partial (some effects are reversible), or none (irreversible). Compensating actions are defined per action class. Time windows for rollback are tracked. The escrow decision in step 8 weighs reversibility: irreversible actions face a higher bar for autonomous execution.

== Target state #target-label

- *Pre-execution simulation via causal digital twin:* Step 7 (Simulate) currently uses rule-based heuristics. The target state connects to the CausalNex Bayesian network for actual posterior predictions of downstream effects.
- *Intent-based multi-agent coordination:* Before an agent acts on an object, it declares intent ("I plan to send a collection email to Invoice X"). A coordinator checks for conflicts (another agent plans to call the customer about the same invoice). Uses optimistic concurrency with intent TTLs.


// ============================================================
// 8. AUTONOMY ENGINE
// ============================================================

= Autonomy Engine

Autonomy is not assigned globally. It is earned per action class from evidence. New action classes begin supervised. Promotion depends on repeated successful execution, procedural quality, business outcomes, and incident frequency. Demotion is immediate.

== Current implementation #current-label

=== Trust levels

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

=== Scoring

*Procedural score.* Did the action follow the policy template? Measured as the percentage of policy predicates that evaluated to true at execution time. Binary per-predicate, averaged across the action.

*Outcome score.* Did the predicted result match the observed result? Measured as whether the actual outcome fell within the model's predicted confidence interval. Averaged over the evaluation window.

*Incident.* Any of: (a) a customer complaint attributed to the action, (b) a constraint violation detected post-execution, or (c) an observed outcome outside 2-sigma of the model's prediction. Classified as minor (recoverable, no customer impact), moderate (customer-visible, recoverable), or critical (financial loss, relationship damage, or compliance violation).

=== Promotion thresholds

*Supervised to Auto + Review.* Rolling 30-day window, per action class, per tenant:
- At least 20 completed executions
- Procedural score at or above 85%
- Outcome score at or above 75%
- At most 1 minor incident, 0 moderate or critical

*Auto + Review to Autonomous.* Rolling 60-day window:
- At least 50 completed executions
- Procedural score at or above 90%
- Outcome score at or above 80%
- Zero incidents of any severity

=== Asymmetric demotion

A single moderate or critical incident triggers immediate demotion to Supervised for the affected action class. The system notifies the operator, provides the full evidence bundle, and resets the trust score.

=== Sparse-data safeguards

In low-volume environments where 20 or 50 executions take months to accumulate, the system does not promote. There is no interpolation, no borrowed confidence from other tenants, and no default promotion schedule.

== Target state #target-label

=== Active learning via Bayesian acquisition functions

Instead of "propose the action with highest expected value," propose "the action whose outcome will teach us the most." Expected Information Gain as the acquisition function. Early in a tenant's lifecycle, this accelerates calibration dramatically by focusing human review on the most informative cases.

=== BALD (Bayesian Active Learning by Disagreement)

Select predictions where ensemble members disagree most. Maximizes mutual information between model parameters and predictions. When ensemble models disagree on a prediction, that is exactly where human input is most valuable. This focuses operator attention where it has the highest return.


// ============================================================
// 9. SIMULATION LAYER
// ============================================================

= Simulation Layer

The long-term purpose of the world model is to simulate what different actions are likely to produce before they occur.

== Current implementation #building-label

Rule-based scenario analysis and hardcoded intervention estimates. The `estimateIntervention()` function applies fixed deltas to current state estimates. Example: sending a collection email increases payment probability by 0.15. These are initial approximations, explicitly acknowledged as heuristic.

The simulation layer is the most aspirational subsystem. The current state is heuristic. The target state is causal. The path from here to there requires sufficient action-outcome data density per tenant.

== Target state #target-label

=== CausalNex Bayesian network

Build a Bayesian network from data and expert knowledge. Support do-calculus interventions that return actual posterior distributions. Replace hardcoded deltas with learned causal effects.

=== Twin networks for counterfactuals

Pearl's twin network construction duplicates every endogenous variable to compute "what would have happened under a different action." This enables true counterfactual reasoning: "Would this invoice have been paid if we had sent the email last week?" Requires full SCM specification, which requires more data density than most tenants will have in early phases.

=== Monte Carlo simulation with causal constraints

Sample from the joint distribution implied by the causal DAG, respecting causal ordering. Propagate interventions forward through time. Output: scenario cards with predicted impact (confidence intervals), tradeoffs, key assumptions, and known unknowns.

=== Honest assessment

Causal simulation at enterprise scale is an open research problem. The techniques above are well-established in academic settings and in specific domains (epidemiology, economics). Applying them to multi-system enterprise operations with sparse, noisy data per tenant is harder. The system design accommodates this by falling back to heuristics when data is insufficient for causal methods. The progression from rules to statistics to causal models is data-driven, not calendar-driven.


// ============================================================
// 10. CONNECTOR FRAMEWORK
// ============================================================

= Connector Framework

Connectors are the observation layer. They ingest events from external systems and transform them into typed WorldEvents for the ledger.

== Architecture

Each connector implements a standard interface:

#code-block[
  interface Connector \{ \
  #h(12pt) type: ConnectorType \
  #h(12pt) tenantId: string \
  #h(12pt) credentials: EncryptedCredentials \
  #h(12pt) syncCursor: string \
  #h(12pt) status: 'active' | 'paused' | 'error' \
  #h(12pt) lastSyncAt: Date \
  #h(12pt) \
  #h(12pt) poll(): AsyncIterable\<SourceEvent\> \
  #h(12pt) handleWebhook(payload: unknown): SourceEvent[] \
  \}
]

Connectors are stateless processors. State lives in the sync cursor (a resumption point for incremental ingestion). This means connectors can be restarted, scaled, or replaced without data loss.

== Extraction pipeline

#fig("Figure 4: Extraction pipeline")[
  #set text(8.5pt)
  #grid(
    columns: (1fr, 10pt, 1fr, 10pt, 1fr, 10pt, 1fr, 10pt, 1fr),
    gutter: 0pt,
    align: center + horizon,
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 6pt, fill: luma(248))[
      #text(7.5pt, weight: "bold")[Raw Event]
      #v(2pt)
      #text(7.5pt)[Webhook or \ poll result]
    ],
    text(fill: luma(170), size: 8pt)[#sym.arrow.r],
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 6pt, fill: luma(248))[
      #text(7.5pt, weight: "bold")[Normalize]
      #v(2pt)
      #text(7.5pt)[Standard \ SourceEvent]
    ],
    text(fill: luma(170), size: 8pt)[#sym.arrow.r],
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 6pt, fill: luma(248))[
      #text(7.5pt, weight: "bold")[Extract]
      #v(2pt)
      #text(7.5pt)[Entities via \ LLM + rules]
    ],
    text(fill: luma(170), size: 8pt)[#sym.arrow.r],
    box(stroke: 0.5pt + luma(190), radius: 2pt, inset: 6pt, fill: luma(248))[
      #text(7.5pt, weight: "bold")[Resolve]
      #v(2pt)
      #text(7.5pt)[Map to \ canonical]
    ],
    text(fill: luma(170), size: 8pt)[#sym.arrow.r],
    box(stroke: 0.8pt + luma(25), radius: 2pt, inset: 6pt, fill: luma(25))[
      #text(7.5pt, weight: "bold", fill: white)[WorldEvent]
      #v(2pt)
      #text(7.5pt, fill: luma(190))[Typed, in \ ledger]
    ],
  )
]

- *Structured sources* (Stripe, QuickBooks API): Rule-based extraction. Confidence 1.0 for direct API fields.
- *Unstructured sources* (email bodies, transcripts): LLM-based extraction with confidence scoring. Results stored with `extractionMethod: 'llm'` and the confidence value.
- Every raw event is written to the ledger before downstream processing, even if extraction fails. This ensures no observation is lost.

== Live connector: Stripe

Webhook events ingested: `invoice.created`, `invoice.paid`, `invoice.payment_failed`, `payment_intent.succeeded`, `charge.dispute.created`, `customer.created`, `customer.updated`.

These transform into typed WorldEvents: `financial.invoice.created`, `financial.payment.received`, `financial.dispute.opened`, `relationship.party.created`.

Object graph types populated: Party, Invoice, Payment, Dispute.


// ============================================================
// 11. GOVERNANCE, SECURITY, AND DATA HANDLING
// ============================================================

= Governance, Security, and Data Handling

== Tenant isolation

Every tenant operates in a fully isolated data partition. Event ledger, object graph, state estimates, policy rules, and autonomy scores are partitioned by tenant ID at the database level. Cross-tenant queries are architecturally impossible: the query layer enforces tenant scoping at the connection level. There is no shared state between tenants.

== Authentication

User authentication through magic link (email OTP) and passkey-based (WebAuthn) flows. No passwords are stored. Session tokens are scoped to the tenant and carry explicit expiration.

== Authorization

The Zanzibar-style authority graph (Section 6) governs all action execution. Approval authority is explicit: only users with the appropriate grant can approve actions in a given action class. The authority graph is itself auditable: all grant changes are logged in the event ledger.

== Audit trail

All evidence bundles (Section 7) are stored in the append-only event ledger with hash-chain integrity. They are immutable and retained for the lifetime of the tenant account. The system can reconstruct the complete decision history for any action: what was proposed, what facts were considered, what policy was applied, who approved, what happened, and what the outcome was.

== Incident response

When the autonomy engine detects an incident:
+ Demote the affected action class to Supervised (immediate)
+ Notify the human operator with the full evidence bundle
+ Log the incident with severity classification
+ For critical incidents: pause all autonomous actions for the tenant until human review

== Data handling

- *PII:* Customer names, email addresses, and other PII are stored as received from the source system. Subject to tenant data retention configuration.
- *Credentials:* No raw credentials stored beyond OAuth tokens managed through the connector framework.
- *Deletion:* Tenant data deletion is supported. Removing a tenant removes all associated events, objects, estimates, and policy state.
- *Encryption:* Data at rest encrypted via PostgreSQL transparent data encryption. Data in transit over TLS.


// ============================================================
// 12. OPERATIONAL METRICS AND TESTING
// ============================================================

= Operational Metrics and Testing

== Test coverage

253 tests across 5 categories, 0 failures:

#table(
  columns: (auto, 1fr, auto),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[Category],
    text(fill: white, weight: "bold", size: 8.5pt)[Coverage],
    text(fill: white, weight: "bold", size: 8.5pt)[Count],
  ),
  text(9pt, weight: "bold")[Unit], text(9pt)[Core logic, object graph operations, policy evaluation, belief computation], text(9pt)[~120],
  text(9pt, weight: "bold")[Integration], text(9pt)[Connector ingestion, gateway pipeline, autonomy promotion, billing], text(9pt)[~60],
  text(9pt, weight: "bold")[Contract], text(9pt)[API surface stability, webhook schema validation], text(9pt)[~30],
  text(9pt, weight: "bold")[Chaos], text(9pt)[Connector failure, latency injection, malformed webhooks, partial outages], text(9pt)[~20],
  text(9pt, weight: "bold")[Load], text(9pt)[100 concurrent tenants, 10,000 objects each], text(9pt)[~23],
)

== Failure modes

- *Connector failure:* System continues with stale data. Alerts operator. Predictions widen confidence intervals.
- *LLM unavailable:* Template-based fallbacks for all LLM functions. System continues operating.
- *Database degradation:* Read replicas for query load. Write failures halt action execution (fail safe).
- *Model degradation:* ADWIN drift detection (target state) triggers automatic fallback to conservative estimates and wider intervals.

The design principle: degrade gracefully, fail safe, never fail silent.


// ============================================================
// 13. TECHNICAL ROADMAP
// ============================================================

= Technical Roadmap

Priority stack for state-of-the-art techniques, ordered by impact relative to implementation effort:

#table(
  columns: (auto, 1fr, auto, auto),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 8.5pt)[\#],
    text(fill: white, weight: "bold", size: 8.5pt)[Technique],
    text(fill: white, weight: "bold", size: 8.5pt)[Library],
    text(fill: white, weight: "bold", size: 8.5pt)[Timeline],
  ),
  text(9pt)[1], text(9pt)[Conformal prediction for guaranteed intervals], text(9pt)[MAPIE], text(9pt)[Weeks],
  text(9pt)[2], text(9pt)[Drift detection on prediction residuals], text(9pt)[River (ADWIN)], text(9pt)[Weeks],
  text(9pt)[3], text(9pt)[Post-hoc calibration (temperature scaling + isotonic)], text(9pt)[scikit-learn], text(9pt)[Weeks],
  text(9pt)[4], text(9pt)[Feature distribution monitoring for OOD detection], text(9pt)[Custom (KL div)], text(9pt)[Weeks],
  text(9pt)[5], text(9pt)[LLM-to-formal-policy compilation], text(9pt)[Custom + LLM], text(9pt)[1-2 months],
  text(9pt)[6], text(9pt)[Intent-based multi-agent coordination], text(9pt)[Custom], text(9pt)[1-2 months],
  text(9pt)[7], text(9pt)[Causal effect estimation (CATE)], text(9pt)[DoWhy + EconML], text(9pt)[2-3 months],
  text(9pt)[8], text(9pt)[Bayesian network simulation], text(9pt)[CausalNex], text(9pt)[2-3 months],
  text(9pt)[9], text(9pt)[Full bi-temporal object graph], text(9pt)[PostgreSQL], text(9pt)[1-2 months],
  text(9pt)[10], text(9pt)[Active learning acquisition functions], text(9pt)[Custom], text(9pt)[3-4 months],
)

Items 1-4 are Python services that can be deployed independently. Items 5-6 are TypeScript extensions to the existing codebase. Items 7-10 require more data infrastructure and depend on sufficient action-outcome data density.


// ============================================================
// 14. REFERENCES
// ============================================================

= References

#set text(8.5pt)
#set par(leading: 0.6em)

+ Gupta, Li, Liu, Subramanian, Suleman, Zhang, Lu, Pasupalak. "World of Workflows: A Benchmark for Bringing World Models to Enterprise Systems." arXiv:2601.22130. January 2026.

+ Guo, Pleiss, Sun, Weinberger. "On Calibration of Modern Neural Networks." ICML 2017. (Temperature scaling for post-hoc calibration.)

+ Athey, Wager. "Estimation and Inference of Heterogeneous Treatment Effects using Random Forests." Journal of the American Statistical Association, 2018. (Causal forests for CATE estimation.)

+ Sharma, Kiciman. "DoWhy: An End-to-End Library for Causal Inference." 2020. (4-step causal inference API.)

+ Beaumont, Sheridan, et al. "CausalNex: Toolkit for Causal Reasoning with Bayesian Networks." McKinsey/QuantumBlack. (Bayesian network do-calculus.)

+ Romano, Patterson, Candes. "Conformalized Quantile Regression." NeurIPS 2019. (Conformal prediction for distribution-free intervals.)

+ Taquet, Blot, Morzadec, Lacombe, Brunel. "MAPIE: Model Agnostic Prediction Interval Estimator." JMLR 2022.

+ Bifet, Gavalda. "Learning from Time-Changing Data with Adaptive Windowing." SDM 2007. (ADWIN algorithm for drift detection.)

+ Cai, Liang, Wang, et al. "Temporal Knowledge Graph Completion: A Survey from the Perspective of Representation Learning." Applied Sciences, 2024.

+ Pearl. "Causality: Models, Reasoning, and Inference." Cambridge University Press, 2009. (Structural causal models, do-calculus, twin networks.)

+ Kaiser, Sipos. "On the Limitations of NOTEARS for Causal Discovery." 2025. (Scale-invariance issues with continuous DAG learning.)

+ Zanzibar: Google's Consistent, Global Authorization System. ATC 2019. (Inspiration for the authority graph design.)


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
    System Architecture \
    nooterra.ai
  ]

  #v(0.2em)

  #text(8.5pt, fill: luma(150))[
    April 2026. Confidential. Shared under NDA.
  ]
]
