# Settld Agent Economy Roadmap (Vision + Workstreams)

Baseline: 2026-02-16 (Mon)

This is a **vision + sequencing** document for the "agent economy" direction.

Near-term execution is **signal-driven** and remains the source of truth for what ships next:

- `planning/sprints/post-hn-signal-driven.md`

---

## Vision

From verify-before-release payments to a fully autonomous agent economy where personal AI agents can represent users, pay for things, do jobs, get paid, employ other agents, and interact with the real world.

## Current Foundation (Repo-Backed)

Already exists in this repo (at least in prototype form):

- x402 gateway demo and API surface (`docs/QUICKSTART_X402_GATEWAY.md`, `services/x402-gateway/`, `POST /x402/gate/create`, `POST /x402/gate/verify`)
- Agent wallet primitives (`AgentWallet.v1`, `GET /agents/:agentId/wallet`, `POST /agents/:agentId/wallet/credit`)
- Agent identity + wallet policy (`AgentIdentity.v1`, `walletPolicy` constraints enforced on hold/settlement creation paths)
- Receiver and finance sink reference services (`services/receiver/`, `services/finance-sink/`)
- Money rails abstraction (currently stubbed; has ops flows + durable operation tracking)

Notably missing for "real money x402":

- A real funding/reserve path (today the demo uses `X402_AUTOFUND=1`)
- A provider onboarding surface (provider keys, payout destinations, trust levels)
- A provider-verifiable payment proof token signed by Settld (trust anchor)

---

## The Wedge (Phase 1)

**Agent Wallet/Gateway**: let AI agents access paid x402-style APIs programmatically without humans managing cards or wallet popups.

The fastest path is: **Circle partner-custody + x402 gateway + Settld-signed payment authorization token + provider-signed responses**.

---

## Locked Decisions (Phase 1)

These were explicitly decided while drafting this roadmap:

- Custody model: **Partner-custody** (Circle first).
- Circle credential ownership: **BYO Circle per tenant in Phase 1**; Settld-managed Circle later.
- Upstream scope: **x402-only in Phase 1**; generic proxy later.
- Payment proof to upstream: **Settld-signed payment authorization token** (provider verifies offline; no chain wait, no Circle API call).
- Trust anchor: **Settld Cloud signs tokens**; providers pin Settld's public key(s).
- Key discovery/rotation: **well-known keyset** with a pinned fallback key for safe rotation.
- Token format: **canonical JSON payload + Ed25519 signature**, TTL **5 minutes**.
- Token delivery header: `Authorization: SettldPay <token>`.
- Provider payee address: **ignore** `x-payment-required address=...`; require **preconfigured provider payout destination**.
- Provider payout destination support: **Circle wallet and onchain address** (per-provider configuration).
- Provider onboarding: **manual allowlist/config** in Phase 1; self-serve later.
- Provider response verification: **required** for real-money release; keep the existing `x-settld-provider-*` signature headers and `ToolProviderSignature.v1` semantics.
- x402 client UX: **support both**:
  - Transparent autopay (default): client sees `200` on the first request.
  - Explicit handshake (flag): client sees `402` and retries.
- Token binding: **gate-only** in Phase 1; request-binding later.
- Guarantee before token issuance: **hard guarantee** (funds reserved/segregated in Circle before token is minted).
- Reserve implementation: start with **transfer into an escrow wallet**, migrate to Circle hold primitives later.
- Circle wallet model: **one Circle wallet per tenant**; Settld maintains per-agent balances as an internal subledger.
- Units: **cents** in Phase 1; token base units (USDC 6 decimals) later.
- Provider settlement cadence: **batch net settle by default**, instant for trusted providers.
- Refund behavior: **auto-void + refund on verification red**.
- Settld revenue model: **per-call fee on top** of provider price.
- Upstream pricing header: do **not** override provider price; rely on tenant wallet policy + per-provider caps.

---

## Phase 1 Architecture (Target Shape)

### Trust surfaces

- Provider trusts **Settld Cloud** as the payment token signer (via well-known keyset discovery + pinning).
- Settld trusts provider as the response signer (provider public key pinned in provider config).

### Provider integration contract (minimum)

Provider implements two things:

1. Verify a Settld payment authorization token (`Authorization: SettldPay ...`) offline.
2. Sign the returned response with the existing `x-settld-provider-*` header suite (Ed25519 over `responseHash` payload).

### Autopay happy path (transparent mode)

1. Client calls gateway `GET /resource`.
2. Upstream returns `402` with `x-payment-required` (price only; address ignored).
3. Gateway calls Settld `POST /x402/gate/create` (creates gate + internal escrow lock).
4. Gateway calls Settld `POST /x402/gate/authorize-payment` (new): Settld reserves funds in Circle escrow and returns a signed payment token.
5. Gateway retries upstream with `Authorization: SettldPay <token>` + `x-settld-gate-id`.
6. Upstream verifies token, returns `200` with `x-settld-provider-*` signature headers.
7. Gateway verifies provider signature and calls Settld `POST /x402/gate/verify`.
8. Settld resolves internal escrow (release/refund) and schedules provider payout per trust tier.

### Explicit handshake (debug/audit mode)

Same as above, except steps 4-5 are initiated by the client retry, and the gateway returns the initial `402` rather than autopaying.

---

## Roadmap Structure

This roadmap is presented as 4 phases across 20 "sprints" (workstream milestones).

Important:

- These are **not** the repo's current sprint numbers (S23+). Treat them as **workstream milestones**.
- Scheduling and "what's open" should still live in GitHub Issues + milestones (`planning/STATUS.md`).

---

## Phase 1: The Agent Wedge (Milestones 1-4)

Goal: ship the magical agent wallet/gateway developers actually want. Revenue begins.

### Milestone 1: Circle-Backed Wallet Foundation (Partner-Custody)

North Star: an agent can receive funds and make autonomous payments programmatically, with Circle custody.

Deliverables:

- Tenant-level Circle wallet integration (BYO Circle credentials)
- USDC deposit flow that credits internal agent subledger balances
- "Hard reserve" primitive: move funds into Circle escrow before issuing payment tokens (transfer into escrow wallet first; Circle hold primitives later)

Acceptance criteria:

- A developer can configure Circle credentials and obtain a USDC deposit address.
- Depositing USDC results in an internal balance increase visible via `GET /agents/:id/wallet`.
- A reserve operation exists: for a given gate, funds are segregated in Circle escrow before any payment token is minted.

### Milestone 2: x402 Autopay + SettldPay Token

North Star: developers give their agents one gateway endpoint; x402 payments happen automatically and safely.

Deliverables:

- Settld-signed payment authorization token (canonical JSON + Ed25519, 5m TTL)
- Gateway transparent autopay mode (default) + explicit handshake mode (flag)
- Provider allowlist/config (manual in Phase 1: payee destination + provider pubkey + trust tier)

Acceptance criteria:

- In transparent mode: one client request returns `200` and includes a deterministic receipt trail (`x-settld-*` headers).
- Token is only minted after Circle reserve succeeds.
- Upstream provider can verify token offline and can dedupe by `gateId`.

### Milestone 3: DX: Provider Kit + Developer Quickstart (Real Money)

North Star: a developer can set up agent billing in under 5 minutes for the first supported provider.

Deliverables:

- Provider integration kit (token verification + response signing reference implementation)
- Updated quickstart path that removes demo shortcuts for the real-money variant (no `X402_AUTOFUND`)
- One "first real provider" integration end-to-end (target: Exa - AI search/retrieval API)

Acceptance criteria:

- A new developer completes a real-money x402 call using Circle-backed reserve + SettldPay token + provider signature verification.
- The quickstart has an objective success check and a single failure-inbound path.

### Milestone 4: Production Hardening + First Revenue

North Star: system handles real money with clear failure semantics; first paying customers.

Deliverables:

- Rate limiting and wallet policy enforcement hardened for gateway path
- Payout scheduling (batch default; instant for trusted providers)
- Billing metering for Settld fees (per-call fee on top)

Acceptance criteria:

- At least one external developer successfully processes paid calls with real funds.
- Verification red auto-voids reserve and refunds deterministically.
- Provider payout reconciliation is auditable (operation logs + deterministic receipt trail).

---

## Phase 2: Identity + Delegation (Milestones 5-8)

Goal: agents have persistent identity; humans can delegate authority to agents with limits.

Note: much of the scaffolding exists already (`AgentIdentity.v1`, `walletPolicy`, delegation concepts). The milestones here focus on turning "proto" into "product-grade" and binding it to the wallet/gateway wedge.

### Milestone 5: Agent Identity System

North Star: every agent has a unique, persistent identity that other agents/providers can verify.

Tickets:

- `STLD-I1` Agent identity registry upgrade (DID optional)
- `STLD-I2` Capability profile schema + validation
- `STLD-I3` Public agent directory (searchable)
- `STLD-I4` Agent authentication (signed challenges)

Success metric: agent can discover and verify another agent's identity.

### Milestone 6: Delegation + Permissions

North Star: humans delegate spending authority to agents with clear limits.

Tickets:

- `STLD-D1` Delegation contracts (spend up to $X)
- `STLD-D2` Permission scopes (limit to specific providers/APIs/categories)
- `STLD-D3` Instant revocation
- `STLD-D4` Delegation dashboard (manage delegations)

Success metric: human delegates $50 to agent, agent cannot exceed $50, revocation is immediate and enforced.

### Milestone 7: Multi-Agent Coordination

North Star: one agent can hire another agent for a subtask, with costs attributed and verifiable.

Tickets:

- `STLD-M1` Sub-agent invocation surface
- `STLD-M2` Task delegation protocol (standard context/requirements envelope)
- `STLD-M3` Result verification binding (parent verifies child output deterministically)
- `STLD-M4` Cost allocation (sub-agent spend attributed to parent run/agreement)

Success metric: agent A hires agent B, gets results, and agent B is paid with a verifiable trail.

### Milestone 8: Agent Reputation System

North Star: agents build reputation based on completed work and verified outcomes.

Tickets:

- `STLD-R1` Reputation ledger (immutable record of verified outcomes)
- `STLD-R2` Rating system (buyer rates seller; aggregate score)
- `STLD-R3` Reputation queries API (pre-hire checks)
- `STLD-R4` Gaming prevention heuristics (fake review detection/penalties)

Success metric: a new agent can query reputation of a potential hire and use it in policy decisions.

---

## Phase 3: Marketplace + Economy (Milestones 9-14)

Goal: full agent-to-agent marketplace; Settld becomes economic infrastructure.

### Milestone 9: Service Discovery

North Star: agents can find other agents that provide specific capabilities.

Tickets:

- `STLD-SD1` Capability registry (services + metadata)
- `STLD-SD2` Search (keyword first; semantic later)
- `STLD-SD3` Availability status (online/offline, SLA tier)
- `STLD-SD4` Discovery API (programmatic)

Success metric: agent can query "find dentist booking agent in Chicago" (at least as a structured capability query).

### Milestone 10: Negotiation Protocol

North Star: agents negotiate price/timeline/terms before work begins.

Tickets:

- `STLD-N1` RFQ schema (request-for-quote format)
- `STLD-N2` Offer/counter-offer message types
- `STLD-N3` Agreement formation (both parties sign)
- `STLD-N4` Agreement storage (immutable/auditable)

Success metric: two agents negotiate and form an agreement without a human in the loop.

### Milestone 11: Escrow + Settlement (Generalized)

North Star: funds are held safely until work is verified, then released automatically.

Tickets:

- `STLD-E1` Escrow engine (generalized beyond x402)
- `STLD-E2` Verification integration (bind to existing verification system)
- `STLD-E3` Automatic release (verified completion triggers payment)
- `STLD-E4` Refund logic (failed/expired tasks refund deterministically)

Success metric: complete flow: agree -> hold funds -> verify -> release/refund.

### Milestone 12: Dispute Resolution

North Star: disputes are handled automatically when possible, with human escalation for the rest.

Tickets:

- `STLD-DS1` Dispute filing
- `STLD-DS2` Evidence submission (both parties)
- `STLD-DS3` Automated resolution for simple cases
- `STLD-DS4` Human escalation (arbiter workflow)

Success metric: first dispute resolved end-to-end through the system.

### Milestone 13: Financial Infrastructure (Deferred Until Demand)

North Star: support multiple currencies and fiat on/off ramps.

Tickets:

- `STLD-F1` Multi-currency wallets
- `STLD-F2` Fiat on-ramp (card/ACH -> wallet)
- `STLD-F3` Fiat off-ramp (wallet -> bank)
- `STLD-F4` FX integration

Success metric: agent receives fiat, converts to USDC, pays for an API.

### Milestone 14: Enterprise Features

North Star: large teams manage multiple agents with controls.

Tickets:

- `STLD-ENT1` Team/org management
- `STLD-ENT2` Budget controls (team/agent limits)
- `STLD-ENT3` Approval workflows (high-value requires human approval)
- `STLD-ENT4` Audit logs (complete trails)

Success metric: an enterprise team runs 10+ agents with budgets and approvals enforced.

---

## Phase 4: Real World Integration (Milestones 15-20)

Goal: agents interact with physical services (bookings, deliveries, confirmations).

This phase is intentionally aspirational and should remain demand-driven.

### Milestone 15: Web2 API Integrations

North Star: agents can call major web services (calendar, email, messaging) with safe OAuth handling.

Tickets:

- `STLD-W21` Calendar integration
- `STLD-W22` Email integration
- `STLD-W23` Communication APIs (SMS/WhatsApp)
- `STLD-W24` OAuth management

Success metric: agent books a meeting and sends a confirmation email.

### Milestone 16: Booking Systems

North Star: agents can book real-world appointments (dentist, restaurant, travel).

Tickets:

- `STLD-B1` Restaurant booking integration
- `STLD-B2` Healthcare booking integration
- `STLD-B3` Travel booking integration
- `STLD-B4` Appointment verification (email/SMS)

Success metric: agent books a dentist appointment for a human.

### Milestone 17: Physical World Oracles

North Star: trusted sources verify real-world events and trigger payments.

Tickets:

- `STLD-O1` Delivery verification (tracking oracles)
- `STLD-O2` Location verification
- `STLD-O3` Time verification
- `STLD-O4` Oracle registry + reputation

Success metric: oracle confirms delivery and triggers payment release.

### Milestone 18: Natural Language Interface

North Star: humans direct agents in plain English; agents can explain and audit what they did.

Tickets:

- `STLD-NL1` Conversational interface
- `STLD-NL2` Preference learning
- `STLD-NL3` Explanation generation
- `STLD-NL4` Conversation history (long-term memory)

Success metric: "book me a cleaning" results in a completed workflow with receipts and an explanation trail.

### Milestone 19: Personal Agent Assistant

North Star: each user has a personal agent that can act with delegated authority and continuity.

Tickets:

- `STLD-PA1` Personal agent creation
- `STLD-PA2` Preference profile
- `STLD-PA3` Context continuity
- `STLD-PA4` Multi-modal access (chat/voice/mobile)

Success metric: user creates a personal agent and successfully delegates a first task.

### Milestone 20: Agent Economy Scaling

North Star: thousands of agents and meaningful transaction volume, with real operational visibility.

Tickets:

- `STLD-SC1` Agent marketplace surface (browse/hire)
- `STLD-SC2` Agent specialization (domain focus)
- `STLD-SC3` Agent networks (collaboration)
- `STLD-SC4` Economic dashboard (real-time metrics)

Success metric: >= 1000 active agents and >= $1M monthly volume.

---

## Success Metrics (Targets)

These are aspirational and should be revised based on real adoption signal.

| Metric | Milestone 4 | Milestone 8 | Milestone 14 | Milestone 20 |
|---|---:|---:|---:|---:|
| Active agents | 10 | 100 | 1,000 | 10,000 |
| Monthly volume | $1K | $100K | $1M | $10M |
| Paying customers | 1 | 10 | 100 | 1,000 |
| Provider APIs | 5 | 50 | 200 | 1,000 |
| Settlement time | < 1hr | < 5min | < 1min | < 30s |

---

## Phase Transition Gates (When To Add Complexity)

Move Phase 1 -> Phase 2 only when BOTH are true:

- Volume threshold: >= $10,000/month processed (paid) volume through the x402 wedge.
- Provider quality threshold: >= 3 providers integrated with < 10% (7d rolling) combined payment+verify failures.

Move x402-only -> generic proxy only when the wedge is proven and the incremental demand is clear (and worth the added security surface of storing provider credentials).
