# SettlementKernel.v1

`SettlementKernel.v1` defines the binding invariants between `AgentRunSettlement.v1`, `SettlementDecisionRecord.v1|v2`, and `SettlementReceipt.v1`.

The kernel is considered valid only when artifact hash integrity, identity binding, and temporal ordering all hold.

## Kernel invariants

- Settlement object exists and has the expected `runId`.
- `decisionRecord` exists and has a valid `decisionHash` (`sha256` over canonical JSON without `decisionHash`).
- `decisionRecord.runId` and `decisionRecord.settlementId` match settlement.
- `settlementReceipt` exists and has a valid `receiptHash` (`sha256` over canonical JSON without `receiptHash`).
- `settlementReceipt.runId` and `settlementReceipt.settlementId` match settlement.
- `settlementReceipt.decisionRef` must exist and bind to `decisionRecord` (`decisionId` + `decisionHash`).
- Temporal ordering must hold:
  - `decisionRecord.decidedAt` is valid ISO date-time.
  - `settlementReceipt.createdAt` is valid ISO date-time.
  - `settlementReceipt.settledAt`, when present, is valid ISO date-time.
  - `settlementReceipt.createdAt >= decisionRecord.decidedAt`.
  - `settlementReceipt.settledAt >= decisionRecord.decidedAt` (when present).
  - `settlementReceipt.settledAt >= settlementReceipt.createdAt` (when present).

## Verification error code semantics

When kernel verification fails, implementations return one or more stable codes:

- `settlement_missing`
- `settlement_run_id_mismatch`
- `decision_record_missing`
- `decision_record_hash_invalid`
- `decision_record_hash_mismatch`
- `decision_record_run_id_mismatch`
- `decision_record_settlement_id_mismatch`
- `settlement_receipt_missing`
- `settlement_receipt_hash_invalid`
- `settlement_receipt_hash_mismatch`
- `settlement_receipt_run_id_mismatch`
- `settlement_receipt_settlement_id_mismatch`
- `settlement_receipt_decision_ref_missing`
- `settlement_receipt_decision_id_mismatch`
- `settlement_receipt_decision_hash_mismatch`
- `decision_record_decided_at_invalid`
- `settlement_receipt_created_at_invalid`
- `settlement_receipt_settled_at_invalid`
- `settlement_receipt_before_decision`
- `settlement_receipt_settled_before_decision`
- `settlement_receipt_settled_before_created`

## API-level enforcement

- Settlement mutation routes reject invalid bindings with:
  - HTTP `409`
  - error code `SETTLEMENT_KERNEL_BINDING_INVALID`
  - `details.errors[]` containing kernel verification codes above.

- `/ops/network/command-center` exposes settlement-kernel health via:
  - `commandCenter.settlement.kernelVerificationErrorCount`
  - `commandCenter.settlement.kernelVerificationErrorCountsByCode[]`
  - alert type `settlement_kernel_verification_error_code` when configured thresholds are breached.
