# Settld Agentverse Build Plan (Adoption-First)

## Mandate

Build the foundational primitive stack for autonomous agents while maximizing user adoption first.

Operating principle:
- Free and easy to start.
- Deterministic and safe by default.
- Portable trust artifacts independent of Settld runtime.

## Success metrics (north star)

1. Time to first successful verified transaction: `< 10 minutes`.
2. Weekly active builders (WAB): sustained growth week-over-week.
3. Day-7 builder retention: target upward trend each sprint.
4. Runtime safety intervention latency: within SLO target.
5. Deterministic replay/verification drift incidents: `0` in release candidates.

## Sprint cadence

- Sprint length: 2 weeks.
- Planning horizon: 4 active sprints (8 weeks), rolling update.
- Release gate: every sprint close includes reliability + determinism checks.

## Sprint map

### Sprint S1: Foundation enforcement + MCP production baseline

Goals:
- Enforce runtime identity/delegation/intent on privileged paths.
- Productionize MCP server (move beyond spike posture).

Tickets:
- STLD-TA01, STLD-TA02, STLD-TA03, STLD-TA04
- STLD-TC01, STLD-TC02

Exit criteria:
- Privileged execution fail-closed without valid identity/delegation/intent.
- MCP quickstart works across Claude/Cursor/Codex/OpenClaw host guides.

### Sprint S2: Runtime safety + activation funnel

Goals:
- Add live anomaly detection and intervention controls.
- Ship free-tier onboarding path to first success in under 10 minutes.

Tickets:
- STLD-TA05
- STLD-TB01, STLD-TB02, STLD-TB03
- STLD-TC03, STLD-TC04, STLD-TC05
- STLD-TE01

Exit criteria:
- Active-run intervention control plane working with audit trail.
- Activation funnel instrumented with measurable drop-off and retention.

### Sprint S3: Transparency trust network + compliance baseline

Goals:
- Introduce transparency/gossip consistency primitives.
- Implement data governance and supply-chain trust baselines.

Tickets:
- STLD-TB04, STLD-TB05
- STLD-TD01, STLD-TD02, STLD-TD03
- STLD-TE02, STLD-TE03

Exit criteria:
- Inclusion proofs and consistency checks available.
- Tenant-level residency/retention controls and SBOM-based release checks active.

### Sprint S4: Operational maturity + public trust posture

Goals:
- Complete trust anchor/key rotation and runtime SLO drills.
- Publish roadmap/governance transparency for ecosystem scaling.

Tickets:
- STLD-TD04
- STLD-TE04, STLD-TE05

Exit criteria:
- Rotation drills and incident rehearsals pass with evidence.
- Public roadmap/changelog is current and release-linked.

## Delivery rules

1. No ticket closes without deterministic tests or objective success checks.
2. New error/failure behavior requires stable code + docs update.
3. Any security/governance control must include rollback and incident handling notes.
4. Adoption work is first-class: docs, templates, and onboarding are release-critical.

## What we explicitly defer

1. Premature monetization complexity.
2. Broad tokenomics experiments.
3. Vertical-specific compliance deep packs beyond baseline controls.

## Review cadence

- Weekly execution review: blockers, risks, and metric deltas.
- Sprint close review: shipped evidence, failed assumptions, and scope resets.
