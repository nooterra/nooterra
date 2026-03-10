# ActionWalletSemanticHashes.v1

This document freezes the deterministic semantic-hash contract for the Action Wallet v1 launch objects.

All Action Wallet semantic hashes use:

- canonical JSON normalization
- UTF-8 bytes
- `sha256`
- lowercase hex output

## Intent

- `ActionIntent.v1.intentHash` is the semantic hash for the launch intent.
- In v1 it resolves directly from `AuthorityEnvelope.v1.envelopeHash`.
- This means hosted approval URLs, approval status, and other read-time alias context do not affect the intent hash.

## Execution Grant

- `ExecutionGrant.v1.grantHash` is the semantic hash for an issued launch grant.
- It is `null` until the grant is actually approved or materialized.
- It hashes the grant semantics and approval bindings:
  - `executionGrantId`
  - `principal`
  - `actionType`
  - `hostId`
  - `vendorOrDomainAllowlist`
  - `spendCap`
  - `expiresAt`
  - `grantNonce`
  - `delegationLineageRef`
  - `evidenceRequirements`
  - `authorityEnvelopeRef`
  - `approvalRequestRef`
  - `approvalDecisionRef`
- It does not hash operational projection fields like `status`, `createdAt`, `continuation`, `workOrderId`, `requiredCapability`, or the duplicate `spendEnvelope`.

## Evidence Bundle

- `EvidenceBundle.v1.evidenceBundleHash` and `ActionReceipt.v1.evidenceBundle.evidenceBundleHash` use the same semantic-hash contract.
- They hash only the proof set and optional attestation binding:
  - `executionGrantId`
  - `workOrderId`
  - normalized `evidenceRefs`
  - `executionAttestationRef`
- They do not hash progress-only transport fields such as `progressId`, `eventType`, `message`, `percentComplete`, `at`, or `submittedAt`.
- `evidenceRefs` are normalized as a sorted unique set before hashing.

## Receipt

- `ActionReceipt.v1.receiptHash` is the semantic hash for the launch receipt.
- In v1 it resolves directly from the canonical `SubAgentCompletionReceipt.v1.receiptHash`.
- Receipt bindings remain explicit:
  - `executionGrantRef.grantHash` binds the receipt to the deterministic execution grant
  - `evidenceBundle.evidenceBundleHash` binds the receipt to the deterministic evidence bundle

## Fail-Closed Rules

- Semantic hash fields must be valid lowercase 64-character `sha256` hex when present.
- Invalid hash formats must fail closed rather than silently normalizing to a different meaning.
