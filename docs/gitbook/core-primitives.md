# Core Primitives

Settld works because every financial outcome is tied to signed, hash-bound artifacts.

## Canonical transaction chain

For Kernel v0 paid capability calls, the critical chain is:

1. `ToolManifest` — provider capability identity + verifier hints
2. `AuthorityGrant` — spend/scope/time authorization
3. `ToolCallAgreement` — terms + `callId` + `inputHash` commitment
4. `FundingHold` — reserved funds prior to execution
5. `ToolCallEvidence` — signed execution evidence
6. `SettlementDecisionRecord` — evaluation result and reasoning
7. `SettlementReceipt` — finalized settlement artifact
8. Optional disputes:
   - `DisputeOpenEnvelope`
   - `ArbitrationCase`
   - `ArbitrationVerdict`
   - `SettlementAdjustment`

## Why each primitive exists

- **Manifest** prevents silent capability identity swaps.
- **Grant** prevents unauthorized spend.
- **Agreement** turns “payment authorization” into “work authorization.”
- **Hold** guarantees escrow semantics before work is done.
- **Evidence** binds outputs to specific agreed inputs.
- **Decision** makes acceptance/rejection explicit and replayable.
- **Receipt** records final settlement state.
- **Dispute + adjustment** gives deterministic remediation on held funds.

## Critical invariants

- One deterministic settlement result per agreement hash.
- Evidence must match committed agreement identifiers (`callId`, `inputHash`).
- Holdback auto-release must be blocked while an open arbitration case exists.
- Deterministic adjustment IDs must prevent double application.
- Replay-evaluate must compare recomputed outcome to stored decision facts.

## Policy and replay pinning

SettlementDecisionRecord v2 pins replay-critical policy data (such as policy hash usage), so re-evaluation can be audited against the exact logic context that produced the original decision.

## Determinism scope

Determinism in Settld means:

- canonicalized artifact hashing
- signed payloads with explicit bindings
- deterministic IDs for idempotent effects
- reproducible verification/replay checks

It does **not** mean all business logic is universally objective; it means the system can prove how a decision was made under a declared policy/verifier surface.

## Related spec docs

- `docs/spec/README.md`
- `docs/spec/INVARIANTS.md`
- `docs/spec/SettlementDecisionRecord.v2.md`
- `docs/spec/DisputeOpenEnvelope.v1.md`
- `docs/spec/ClosePack.v1.md`
