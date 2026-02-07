# 30-Day Self-Serve Launch Board (ICP v1: AI Tool Providers)

Date baseline: February 7, 2026
Owner: PM + Backend + DevEx + GTM
Epic: `STLD-E12`

## ICP v1 definition

- Segment: AI tool providers (1-30 engineers, API-first, rapid ship cadence)
- Buyers: founder, product engineer, platform lead
- Primary users: backend and platform engineers integrating proof/settlement/dispute APIs
- Trigger events: paid endpoint launch, dispute/refund growth, enterprise onboarding requiring verifiable receipts
- Must-win outcomes: machine-verifiable receipts, automatic settlement, policy caps, dispute workflow

## Positioning

Settld for AI Tool Providers:

`Turn any tool invocation into a verified economic transaction: contract, proof, settlement, dispute.`

## Pricing v1 (self-serve usage-led)

1. Free
- Sandbox only + capped live trial
- No real payout rails

2. Builder ($99/mo)
- 10k verified runs/month included
- 0.75% settled volume fee
- Basic dispute workflows
- 30-day evidence retention

3. Growth ($599/mo)
- 100k verified runs/month included
- 0.45% settled volume fee
- Arbitration queue + policy packs
- 180-day retention + exports

4. Enterprise (custom annual)
- volume tiers
- 0.20%-0.35% settled volume fee
- custom compliance/support terms

Overages:
- verified runs: $0.01/run (Builder), $0.007/run (Growth)
- arbitration cases: $2/case (Builder), $1/case (Growth)

## North-star and funnel

- North-star: `MVSV` (Monthly Verified Settled Value)
- Secondary: verified settlements count, take-rate revenue, dispute rate, time-to-first-settlement

Funnel:
1. signup
2. tenant + API key created
3. first instrumented endpoint
4. first verified run
5. first live settlement

## Week-by-week execution

### Week 1: Productization core
- `STLD-T183` persist money rail operations/events
- `STLD-T184` wire durable money rail adapter into API
- `STLD-T185` ship billable usage event ledger
- `STLD-T186` billing pipeline ingestion worker

### Week 2: Self-serve commercial layer
- `STLD-T187` publish `/pricing`
- `STLD-T188` Stripe self-serve checkout + plan lifecycle
- `STLD-T189` plan quota enforcement in API gateway
- `STLD-T190` overage billing + threshold alerts

### Week 3: Trust + ops surface
- `STLD-T191` arbitration queue UI
- `STLD-T192` arbitration evidence/ruling workspace
- `STLD-T193` policy presets (budget caps, dispute windows, holdbacks)
- `STLD-T194` public verified receipt endpoint + badge

### Week 4: Launch + growth
- `STLD-T195` 10-minute first-settlement quickstart
- `STLD-T196` three reference integrations
- `STLD-T197` launch docs + changelog + onboarding email sequence
- `STLD-T198` benchmark report + referral loop
- `STLD-T199` MVSV dashboard + go/no-go launch gate

## 30-day launch exit criteria

- 20 self-serve signups
- 8 teams reach first live settlement
- 3 paying customers
- median time-to-first-settlement < 20 minutes
- arbitration median resolution < 24 hours

## Dependency anchors to current master backlog

- Money rails/reconcile: `STLD-T171`, `STLD-T172`
- Billing and pricing baseline: `STLD-T141`, `STLD-T142`, `STLD-T143`, `STLD-T144`, `STLD-T179`
- Arbitration foundation: `STLD-T173`
- Policy/delegation controls: `STLD-T122`, `STLD-T124`
- Scale/benchmark baseline: `STLD-T177`
- Reference apps baseline: `STLD-T178`
