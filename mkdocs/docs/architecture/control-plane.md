# Control Plane

Settld is the enforcement layer between autonomous actions and settlement.

## Layer model

1. **Identity and delegation**
   - Agent identity, delegation lineage, revocation/expiry checks
2. **Policy decision**
   - Deterministic outcome: `allow`, `challenge`, `deny`, `escalate`
3. **Execution binding**
   - Request binding to policy/authorization context
4. **Settlement and lifecycle**
   - Authorization, verification, release/refund/reversal paths
5. **Evidence and operations**
   - Receipt bundles, closepacks, replay, audit exports

## Hard invariants

- No paid settlement without verification checks.
- No override without signed operator decision.
- No mutable receipt history (append-only timeline).
- No bypass path around policy runtime for high-risk actions.

## Why this matters

Payment rails can settle money.
Settld makes agent settlement trustworthy, explainable, and operable under incident pressure.
