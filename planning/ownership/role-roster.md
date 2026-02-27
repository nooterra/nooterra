# Nooterra Agent Network Role Roster (Adoption-First Execution)

## Operating model

- Team objective: maximize real builder adoption while enforcing safety and determinism.
- Sprint cadence: 2 weeks.
- Planning horizon: rolling 4 sprints.

## Core role ownership

### PM / Founder Office
- Owns scope discipline and user-first roadmap.
- Owns activation metrics and retention targets.
- Owns public roadmap/governance communications.

Primary tickets:
- STLD-TC05, STLD-TE05

### Tech Lead / Architecture
- Owns target-state architecture and sequencing.
- Owns migration safety for runtime-enforced identity/delegation/intent.
- Owns rejected alternatives and rollback strategy decisions.

Primary tickets:
- STLD-TA05

### Backend Platform
- Owns runtime enforcement on x402 and execution paths.
- Owns anomaly engine integration and intervention backend controls.
- Owns transparency log and consistency verifier APIs.

Primary tickets:
- STLD-TA01, STLD-TA02, STLD-TA03, STLD-TA04
- STLD-TB01, STLD-TB03, STLD-TB04
- STLD-TD01, STLD-TD02

### Frontend / Operator Surfaces
- Owns intervention and approval workflow UX.
- Owns onboarding flow and template discovery surfaces.

Primary tickets:
- STLD-TB02, STLD-TB05
- STLD-TC03, STLD-TC04

### DevEx / SDK / Documentation
- Owns MCP host integrations and quickstarts.
- Owns copy-paste starter templates and first-success quality.

Primary tickets:
- STLD-TC01, STLD-TC02, STLD-TC04

### QA / Verification
- Owns determinism and replay test gates.
- Owns runtime safety regression suite and offline verifier reproducibility.

Primary tickets:
- STLD-TA04
- STLD-TB01
- STLD-TD03
- STLD-TE04

### DevOps / Security
- Owns release trust posture: key recovery, SBOM, incident drills.
- Owns operational SLOs and runbook readiness.

Primary tickets:
- STLD-TE01, STLD-TE02, STLD-TE03, STLD-TE04
- STLD-TD04

## Capacity guidance

### Phase 1 (now): 8-12 core operators
- 1 PM/founder lead
- 1 tech lead
- 3-4 backend engineers
- 1 frontend engineer
- 1 DevEx engineer
- 1 QA engineer
- 1 DevOps/Security engineer

### Phase 2 (after retention proof): 12-18
- Add frontend, backend, and customer success capacity.

## Priority discipline

1. Runtime safety and identity enforcement are non-negotiable.
2. Adoption friction fixes are release-critical.
3. Nice-to-have platform expansions wait until retention trend is positive.
