# Artifact Lineage

Nooterra artifacts are linked by deterministic IDs and hashes.

## Core lineage chain

1. Policy decision record
2. Execution binding record
3. Settlement decision/receipt
4. Verification report
5. Closepack export bundle

## Common identifiers in flows

- `gateId`
- `decisionId`
- `settlementReceiptId`
- `runId`

## Guarantees

- Each artifact references prior decision context.
- Timeline is append-only; updates emit new events.
- Closepacks include enough material for offline verification.
