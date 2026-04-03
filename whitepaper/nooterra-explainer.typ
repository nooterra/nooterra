// ============================================================
// NOOTERRA EXPLAINER — Product/Technical Explainer
// For non-technical investors, partners, business development.
// 15-20 pages. Clear, concrete, no jargon without explanation.
// ============================================================

#set document(
  title: "Nooterra: How It Works",
  author: "Nooterra, Inc.",
  date: datetime(year: 2026, month: 4, day: 1),
)

#set page(
  paper: "us-letter",
  margin: (top: 1.15in, bottom: 1in, left: 1.1in, right: 1.1in),
  header: context {
    if counter(page).get().first() > 1 [
      #set text(7.5pt, fill: luma(150), tracking: 1.5pt)
      NOOTERRA #h(1fr) #text(tracking: 0pt)[How It Works]
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
  size: 10.5pt,
  fill: luma(25),
)

#set par(
  leading: 0.72em,
  justify: true,
)

#set heading(numbering: "1.")

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  v(0.6em)
  block(below: 0.5em)[
    #text(16pt, weight: "bold", it)
  ]
}

#show heading.where(level: 2): it => {
  v(0.7em)
  block(below: 0.3em)[
    #text(12pt, weight: "bold", it)
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

#let step-box(number, title, desc) = {
  box(
    width: 100%,
    stroke: 0.5pt + luma(190),
    radius: 3pt,
    inset: (x: 12pt, y: 10pt),
    fill: white,
  )[
    #grid(
      columns: (28pt, 1fr),
      gutter: 8pt,
      align(center + horizon)[
        #box(
          width: 24pt,
          height: 24pt,
          fill: luma(25),
          radius: 12pt,
          align(center + horizon, text(11pt, weight: "bold", fill: white)[#number]),
        )
      ],
      [
        #text(10.5pt, weight: "bold")[#title] \
        #text(9.5pt, fill: luma(70))[#desc]
      ],
    )
  ]
}


// ============================================================
// COVER
// ============================================================

#page(header: none, footer: none)[
  #v(2in)

  #text(10pt, weight: "bold", tracking: 5pt, fill: luma(120))[NOOTERRA]

  #v(0.4in)

  #text(26pt, weight: "bold", tracking: -0.3pt)[How It Works]

  #v(0.15in)

  #block(width: 85%)[
    #text(11pt, fill: luma(70))[
      A live model of your business that watches everything, \
      predicts what happens next, and acts on your behalf \
      only as fast as you trust it.
    ]
  ]

  #v(1.8in)

  #text(9.5pt, fill: luma(130))[
    Confidential. For qualified partners and investors. \
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
// 1. WHAT NOOTERRA IS
// ============================================================

= What Nooterra Is

Every AI company right now is building agents that can do things. Send emails. Update records. File tickets. Move data between systems.

None of them can tell you what happens next.

A collection email sent to the wrong customer at the wrong time can trigger a disputed charge, a churned account, and a missed renewal. A refund processed without checking the support ticket history can undermine a relationship your team spent months building. A payment reminder sent while a retry is already scheduled makes your company look incompetent.

Human employees avoid these mistakes because they carry a mental model of the business. They know the customer, the context, the history, and the likely consequences of their actions. AI agents do not.

Nooterra fixes this. It is an enterprise world model platform: a system that maintains a live, continuously updated representation of your company's operational state. It watches every event across your connected business systems, builds a map of every customer, invoice, payment, and conversation, predicts what happens next, and acts on your behalf through a governed process where trust is earned from evidence.

The system runs in a continuous loop:

#v(0.4em)

#fig("The Nooterra Loop")[
  #set text(9.5pt)
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 6pt,
    step-box("1", "Observe", "Watch Stripe, Gmail, QuickBooks, CRM in real time. Every invoice, payment, email, and event is captured."),
    step-box("2", "Model", "Build a live map of every customer, invoice, payment, and conversation. Track relationships across systems."),
    step-box("3", "Predict", "Estimate hidden state. \"72% chance this invoice gets paid in 7 days.\" \"This customer's churn risk just jumped.\""),
  )
  #v(6pt)
  #grid(
    columns: (1fr, 1fr, 1fr),
    gutter: 6pt,
    step-box("4", "Act", "Propose the right action with evidence. Send the right email, to the right person, at the right time."),
    step-box("5", "Evaluate", "Grade every action. Did it follow the rules? Did it achieve the goal? Did anything go wrong?"),
    step-box("6", "Learn", "Model gets more accurate. Agent earns more autonomy. The system improves from its own operations."),
  )
]

#v(0.4em)

This loop runs continuously. Every event updates the model. Every action generates evidence. Every outcome improves the predictions. The system gets better the longer it runs.

== What the user sees

The experience is simple:

+ Connect Stripe (takes 2 minutes)
+ See your company state: every customer, invoice, and payment relationship mapped automatically
+ Get proposals: "Send a soft reminder to Acme Corp about Invoice \#4821. Here's why."
+ Approve or reject with one click
+ Watch autonomy expand: proven actions start running automatically. A single mistake triggers immediate human review.

The complexity is behind the surface. The operator sees proposals and outcomes. The system handles observation, modeling, prediction, policy evaluation, and trust management.


// ============================================================
// 2. THE PROBLEM
// ============================================================

= The Problem: Why AI Agents Fail in Business

Most AI systems deployed in business today follow one of three patterns.

*Assistants* answer questions and draft content. They are useful, but passive. They do not take action.

*Automations* move data between systems on predefined triggers. They are reliable for simple rules ("if invoice overdue, send template email") but break when context matters. A templated reminder sent to a customer with an open support ticket and a pending renewal is worse than no reminder at all.

*Agents* are given tools and goals, then allowed to act. They are powerful. They are also dangerous when they lack a coherent picture of the system they operate inside.

All three patterns share the same structural weakness. They are thin on state. They see the task in front of them. They do not see the web of relationships, constraints, and consequences around it.

#v(0.4em)

#fig("Figure 1: What agents miss")[
  #set text(9.5pt)
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
      #set text(9pt)
      #stack(
        dir: ttb,
        spacing: 3pt,
        block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
          Stripe: payment retry already scheduled. \
          _Customer receives two conflicting messages._
        ],
        block(fill: luma(248), inset: 7pt, radius: 2pt, width: 100%)[
          Support: open ticket escalated to manager. \
          _Collection email undermines the relationship._
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

This problem has a name. Academic researchers call it *dynamics blindness*: the inability of AI agents to predict the hidden state transitions their actions cause. A benchmark study published in January 2026 ("World of Workflows," arXiv) tested frontier AI models against 234 enterprise tasks with over 4,000 active business rules. The best models consistently failed to predict which rules would fire, what side effects would propagate, and which constraints would break.

The conclusion: enterprise AI needs more than better prompts or more reasoning power. It needs an explicit model of business state and business dynamics.

That model is what Nooterra builds.

== The cost is real

U.S. small businesses with unpaid invoices carry \$17,500 in overdue receivables on average (QuickBooks, May 2025). Mid-market firms carry approximately \$304,000. Late payments regularly create payroll stress for SMBs (Bluevine, March 2026). These are not technology problems. They are dynamics problems: businesses lack the operational intelligence to predict which invoices will go overdue, which customers are at risk, and what actions will accelerate collection without damaging relationships.


// ============================================================
// 3. HOW IT WORKS
// ============================================================

= How It Works

The Nooterra loop has six stages. Each one builds on the previous. Here is what happens at each stage, what the user sees, and what the system does internally.

== Stage 1: Observe

*What happens:* The system connects to your business tools and watches everything in real time. When an invoice is created in Stripe, a payment fails, a dispute is opened, or a customer email arrives, the system captures it immediately.

*What the user sees:* An activity feed showing every event as it happens. "Invoice \#4821 created for Acme Corp, \$4,200, due March 28."

*What the system does:* Each event is typed, timestamped, and recorded in an append-only event ledger with hash-chain integrity (the same tamper-evidence technique used in financial audit systems). Every event carries provenance: which system it came from, how it was extracted, and how confident the extraction is.

== Stage 2: Model

*What happens:* Events are transformed into a structured map of your business. Customers, invoices, payments, disputes, and conversations become objects with relationships between them. "Acme Corp owes Invoice \#4821. Invoice \#4821 has 3 related support tickets. Acme Corp's contract renews in 9 days."

*What the user sees:* A company state view showing every entity and its relationships. Click on a customer and see their invoices, payments, communications, and support history in one place.

*What the system does:* Raw events are transformed into canonical objects in a versioned graph. The system resolves entities across sources (the "Acme Corp" in Stripe is the same as "ACME Corporation" in QuickBooks). Every object carries version history, so the system can reconstruct what it knew about any entity at any point in time.

== Stage 3: Predict

*What happens:* The system estimates things it cannot directly observe. "This invoice has a 34% chance of being paid in the next 7 days." "This customer's churn risk is 71%." "There is a 22% probability of a dispute on this charge."

*What the user sees:* A prediction dashboard showing risk scores, payment probabilities, and cash flow forecasts. Each prediction shows its confidence level and the model's historical accuracy for that type of prediction.

*What the system does:* Statistical models (logistic regression, gradient-boosted trees) trained on historical data generate predictions for six targets: payment probability, days to payment, churn risk, dispute probability, customer lifetime value, and DSO forecast. Each prediction is stored alongside its eventual outcome. The system tracks whether its 70% predictions actually come true 70% of the time. When accuracy drifts, the model is flagged for review.

== Stage 4: Act

*What happens:* Based on the company state and predictions, the system proposes actions. "Send a soft reminder to Acme Corp about Invoice \#4821. Use a personal tone because they have open support tickets and a renewal coming up. Here is the evidence for why this is the right action."

*What the user sees:* An approval queue showing proposed actions with evidence bundles. Each proposal explains what it wants to do, why, what it considered, and what it expects to happen. The user approves or rejects with one click.

*What the system does:* Every proposed action passes through an 11-step pipeline before anything touches the real world. The system checks the agent's authority, evaluates policy rules, validates parameters, checks rate limits, verifies budget, injects required disclosures (like "this message was composed with AI assistance"), estimates downstream effects, and decides whether to execute immediately, hold for human approval, or escalate.

Every executed action produces a complete evidence bundle: what was proposed, what facts were considered, what policies were applied, who approved it, what happened, and what the outcome was. These records are immutable and retained permanently.

== Stage 5: Evaluate

*What happens:* Every action is graded on two dimensions. *Procedural:* did it follow the rules? Did it comply with policy, use the right tools, include required disclosures? *Outcome:* did it achieve the goal? Did the invoice get paid? Did the customer respond positively? Did anything unexpected happen?

*What the user sees:* Performance metrics per action type. "Collection emails: 94% procedural quality, 87% outcome quality, 0 incidents this month."

*What the system does:* Execution traces are graded against the procedural checklist and outcome predictions. Results feed into the autonomy engine (Stage 6) and the calibration system (improving future predictions).

== Stage 6: Learn

*What happens:* The system improves from its own operations. Predictions get more accurate as outcomes accumulate. Actions that consistently succeed earn the right to run with less human oversight. Actions that cause problems are immediately demoted to full human review.

*What the user sees:* An autonomy map showing which action types have earned which trust levels. "Soft collection reminders: autonomous. Payment plan offers: supervised. Dispute responses: locked."

*What the system does:* The autonomy engine tracks trust per action type, per tenant. New actions start in supervised mode (every one needs human approval). After enough successful executions with high procedural and outcome scores, the system recommends promotion to automatic mode. A single serious incident triggers immediate demotion back to supervised. Trust is earned through evidence, never granted by default.


// ============================================================
// 4. WHAT'S BUILT
// ============================================================

= What Is Built Today

The system is live with Stripe as the first connected source. Here is what exists, what is in development, and what is planned.

#v(0.3em)

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 8pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 9pt)[Status],
    text(fill: white, weight: "bold", size: 9pt)[Details],
  ),
  [#badge("Live", dark: true)],
  [
    Stripe integration (webhooks, typed events, canonical objects). Event ledger with tamper-evident integrity. Object graph with customers, invoices, payments, disputes, and relationships. Prediction models for payment probability, churn risk, and dispute probability. Policy engine with deterministic rules. Action gateway with evidence bundles. Earned autonomy with promotion and demotion. Eight production dashboard views. 253 passing tests across unit, integration, contract, chaos, and load categories. Production infrastructure on Railway.
  ],
  [#badge("Building")],
  [
    Additional data sources (Gmail, QuickBooks, CRM). Simulation engine for "what if" scenario analysis. Closed-loop calibration feeding outcomes back to improve predictions automatically.
  ],
  [#badge("Target")],
  [
    Cross-domain reasoning (AR + support + CRM in one model). Causal inference replacing statistical heuristics. Domain pack SDK for third-party extensions. Privacy-preserving learning across tenants.
  ],
)

#v(0.3em)

== The eight dashboard views

+ *Command Center:* Health indicators, activity stream, company metrics at a glance
+ *Company State:* Object graph explorer. Click any customer to see invoices, payments, communications, and relationships.
+ *Prediction Dashboard:* Payment probability scores, cash flow predictions, per-invoice risk assessment
+ *Autonomy Map:* Trust grid showing which agents can do what, and at which trust level
+ *Approval Queue:* Pending proposals with evidence bundles. One-click approve or reject.
+ *Policy Editor:* Write rules in natural language. The system enforces them as deterministic guards.
+ *Onboarding:* Stripe connection wizard. Live in 2 minutes.
+ *Landing Page:* Interactive walkthrough of the system's value proposition


// ============================================================
// 5. THE WORLD MODEL
// ============================================================

= The World Model: How Predictions Work

The world model is the core intellectual property. It is how the system goes from raw events to actionable predictions. Here is what it does, mechanistically.

== From events to objects

When Stripe sends a webhook ("Invoice \#4821 payment failed"), the system does three things:

+ *Records the raw event* in the append-only ledger. This event is immutable and timestamped. It can never be changed or deleted.
+ *Updates the object graph.* Invoice \#4821 is now marked as failed. The customer's payment history is updated. The relationship between the customer and the invoice reflects the new state.
+ *Triggers re-estimation.* The system recalculates predictions for the affected objects. Payment probability drops. Churn risk increases. The dispute probability may change based on the customer's history.

== From objects to predictions

The system runs multiple prediction models, each focused on a specific target:

#table(
  columns: (1fr, auto, auto),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 9pt)[What it predicts],
    text(fill: white, weight: "bold", size: 9pt)[Output],
    text(fill: white, weight: "bold", size: 9pt)[Horizon],
  ),
  [Will this invoice get paid?], [Probability (0 to 1)], [7, 30, 90 days],
  [When will payment arrive?], [Distribution of days], [Per invoice],
  [Will this customer leave?], [Probability (0 to 1)], [30, 90 days],
  [Will this charge be disputed?], [Probability (0 to 1)], [Per invoice],
  [What is this customer worth?], [Distribution of dollars], [12 months],
  [What will DSO look like?], [Distribution of days], [30/60/90 days],
)

Each prediction carries a confidence level and the model's historical accuracy for that prediction type. A model that predicts 70% payment probability should see approximately 70% of those invoices actually get paid. The system tracks this continuously and alerts when accuracy degrades.

== What confidence actually means

When the system says "34% chance of payment in 7 days with confidence 0.82," it means two things:

- *34%* is the model's estimate of payment probability for this specific invoice, given everything it knows about the customer, the amount, the payment history, and the current state.
- *0.82 confidence* means the model has historically been accurate 82% of the time on similar predictions. If this number drops, the system flags the model for review and falls back to more conservative estimates.

This separation between "what do we think?" and "how good are we at thinking about this?" is what makes the predictions trustworthy. The system is honest about its own limitations.

== The role of the AI model

The AI language model (GPT-4, Claude, Gemini, routed through a multi-provider system) is used for four specific functions:

+ *Reading unstructured data:* Parsing email bodies, extracting customer names from conversations, understanding the content of support tickets.
+ *Writing content:* Drafting collection emails, summarizing evidence bundles, generating human-readable explanations for predictions.
+ *Matching entities:* Recognizing that "Acme Corp" in Stripe and "ACME Corporation" in QuickBooks are the same customer.
+ *Explaining decisions:* Translating the system's internal reasoning into natural language that a human operator can understand.

The AI model is *not* used for making predictions (that is the statistical model), making policy decisions (that is the rule engine), granting autonomy (that is the evidence-based promotion system), or storing data (that is the database).

Every AI call has a maximum cost limit, a retry limit, and a fallback template. If the AI is unavailable, the system continues operating. The AI makes things better. It does not make things possible.


// ============================================================
// 6. EARNED AUTONOMY
// ============================================================

= Earned Autonomy: How Trust Works

The most important design decision in Nooterra is how it handles trust. Rather than giving AI agents a fixed set of permissions, the system lets each type of action independently earn the right to run with less human oversight.

== The five trust levels

#table(
  columns: (auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 8pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 9pt)[Level],
    text(fill: white, weight: "bold", size: 9pt)[What happens],
  ),
  text(10pt, weight: "bold")[Locked], [This action type is forbidden. Cannot be used at all.],
  text(10pt, weight: "bold")[Shadow], [The system proposes actions internally, but the user never sees them. Used for testing.],
  text(10pt, weight: "bold")[Supervised], [The system proposes actions and the user must approve each one. This is the default for all new action types.],
  text(10pt, weight: "bold")[Auto + Review], [The system executes the action automatically, and the user reviews afterward. Requires strong evidence of past success.],
  text(10pt, weight: "bold")[Autonomous], [The system acts without human involvement. Requires extensive evidence and zero incidents.],
)

== How promotion works

An action type earns promotion through evidence. To move from Supervised to Auto + Review, the system needs at least 20 successful executions over 30 days, with high scores for both "did it follow the rules?" and "did it achieve the goal?" and almost no incidents.

To reach fully Autonomous, the bar is even higher: 50+ executions over 60 days, higher quality scores, and zero incidents of any kind.

== How demotion works

Promotion is slow. Demotion is immediate. A single serious incident (a customer complaint, a policy violation, or an outcome that is significantly worse than predicted) triggers automatic demotion back to Supervised mode. The system notifies the human operator, shows the full evidence of what happened, and resets the trust score.

This asymmetry is deliberate. The cost of asking a human to approve an action they would have approved anyway is low. The cost of an unsupervised mistake is high.

== Why this matters for adoption

Organizations will not deploy fully autonomous AI on day one. They should not. What they will deploy is a system that starts cautiously, proves its competence through observable evidence, and can be demoted instantly if it makes a mistake. This is how human employees earn trust. Nooterra applies the same model, backed by data.


// ============================================================
// 7. WHY THIS WINS
// ============================================================

= Why Nooterra Wins

== The competitive landscape

#table(
  columns: (auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 9pt)[Category],
    text(fill: white, weight: "bold", size: 9pt)[Examples],
    text(fill: white, weight: "bold", size: 9pt)[What They Lack],
  ),
  [AI Agent Frameworks], [CrewAI, AutoGen, LangGraph], [No world model. No governance. No persistent state. Developer tooling, not a product.],
  [Vertical AR Tools], [Tesorio, Upflow, Bill.com], [Timer-based reminders. No state estimation, no cross-domain awareness, no earned autonomy.],
  [Workflow Automation], [Zapier, Make, n8n], [Task execution without understanding consequences. No simulation, no governance.],
  [Foundation Model Cos.], [Anthropic, OpenAI, Google], [Horizontal platforms selling APIs. Vertical domain runtimes require data they do not have.],
)

== What about the big AI companies?

The most common question: will Anthropic, OpenAI, or Google build this?

They could build a general-purpose state-tracking layer. The value in Nooterra is not the state-tracking layer. It is the calibrated prediction models trained on proprietary action-outcome data, the domain-specific policy engines, and the tenant-level trust histories that accumulate over months of real use. These are vertical data assets, not features.

Foundation model companies build horizontal platforms. Nooterra builds the vertical intelligence layer on top. We use their APIs. We are not competing for the same budget.

== The four moats

*Proprietary data.* Every tenant's approvals, rejections, outcomes, and incidents become training signal. This data does not exist in any public dataset. No one else has enterprise action-outcome pairs with full context, policy state, and confidence intervals attached.

*Trust lock-in.* Once a company has spent months training autonomy levels, building custom policies, and calibrating predictions, switching means starting at zero trust. Trust histories cannot be exported.

*Engineering depth.* The combination of event ledger, object graph, state estimator, policy engine, action gateway, and autonomy engine represents 12 to 18 months of infrastructure engineering. The first team to ship it with a working product has a structural head start.

*Cross-domain compounding.* Each new data source increases the value of every existing source. When AR, support, and CRM are all connected, the system sees patterns no single-domain tool can see: "Do not send that collection email because this customer has an open support ticket and a pending renewal."


// ============================================================
// 8. COMMERCIAL MODEL
// ============================================================

= Commercial Model

Nooterra prices on business value, not compute. Customers do not care how many AI tokens were consumed. They care whether cash arrived faster and whether bad actions were prevented.

#v(0.3em)

#table(
  columns: (auto, auto, auto, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 9pt)[Tier],
    text(fill: white, weight: "bold", size: 9pt)[Price],
    text(fill: white, weight: "bold", size: 9pt)[For],
    text(fill: white, weight: "bold", size: 9pt)[What You Get],
  ),
  [Sandbox], [\$0], [Evaluation], [1 Stripe account, shadow mode, time-boxed trial],
  [Starter], [\$149/mo], [Founder-led SMBs], [1 agent, Stripe world model, approval queue, predictions],
  [Business], [\$499/mo], [Growing businesses], [Full autonomy, multiple runtimes, Slack approvals],
  [Finance Ops], [\$799--1,500/mo], [Finance teams], [Multi-user, audit/export, custom policies, premium support],
  [Enterprise], [Custom], [Mid-market+], [Multi-system, SSO/SCIM, custom connectors, SLA],
)

#v(0.3em)

== Unit economics

AI cost per customer: approximately \$50/month. At the Business tier (\$499/month), that is an 87% gross margin. Even at Starter (\$149/month), the margin is approximately 56%. These economics improve as models get cheaper and the system optimizes which AI model to use for which task (routing simple tasks to cheaper models, complex judgment to expensive ones).

== Go-to-market

*Months 1--6:* Design partner pilots. Hand-selected B2B service companies. Free access in exchange for weekly feedback. Goal: 5--10 partners, measurable reduction in days sales outstanding.

*Months 4--8:* Invite-only launch. 50 companies from the waitlist. Paid Starter and Business tiers. Content marketing with partner case studies.

*Months 7--12:* Open access. Self-serve sandbox trial. Bookkeeper and accountant referral program.


// ============================================================
// 9. THE VISION
// ============================================================

= The Vision: From Wedge to Platform

The product starts narrow. That is deliberate.

Stripe-first accounts receivable is chosen because it has the cleanest event stream, the fastest feedback loops, the most measurable outcomes, and the simplest onboarding. It is the fastest path to a validated world model and a meaningful dataset of action-outcome pairs.

The expansion sequence builds on this foundation:

#v(0.3em)

#table(
  columns: (auto, auto, 1fr, 1fr),
  stroke: 0.4pt + luma(200),
  inset: 7pt,
  fill: (x, y) => if y == 0 { luma(25) } else if calc.odd(y) { luma(250) } else { white },
  table.header(
    text(fill: white, weight: "bold", size: 9pt)[Phase],
    text(fill: white, weight: "bold", size: 9pt)[Timeline],
    text(fill: white, weight: "bold", size: 9pt)[What Gets Built],
    text(fill: white, weight: "bold", size: 9pt)[How We Know It Worked],
  ),
  [AR Wedge], [Months 1--6], [Stripe world model. Shadow collections. Governed actions. Earned autonomy.], [5--10 design partners. Measurable DSO reduction.],
  [Finance \ Control Plane], [Months 7--12], [Disputes, refunds, cash forecasting. Gmail and QuickBooks integration. Scenario simulation.], [200 paying customers. First case studies published.],
  [Multi-Domain \ Platform], [Months 13--24], [CRM integration. Cross-domain relationships. Domain pack architecture. Support ops.], [1,000+ customers. Enterprise deals. Platform thesis validated.],
)

#v(0.3em)

Each phase depends on the previous one. Expansion into disputes requires the collections infrastructure. Multi-source reasoning requires the single-source model to be calibrated and trusted. Domain packs require the platform architecture to be proven.

Expansion is earned, not declared.

#v(0.3em)

#callout[
  #text(10pt)[
    *The long-term vision:* Any business can provision a governed AI operator the way it provisions a database. Identity, permissions, budget, memory, world model access, and a liability envelope, all in one step. The system learns from every action it takes, earns trust through evidence, and gets demoted the moment it makes a mistake.
  ]
]


// ============================================================
// CLOSING
// ============================================================

#v(2em)
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
