# Nooterra Conformance Harness (Draft)

This document outlines the conformance suite required to claim **Nooterra Core Compatible**.

## Scope
- **Schemas**: ACARD (Profile 0-3), Receipt (NIP-0002)
- **Vectors**: Canonical ACARD, Profile 3 ACARD, Receipt sample
- **APIs**: `/v1/workflows/publish`, `/v1/workflows/:id`, `/v1/receipts/verify`, `/v1/agent/discovery`

## Required Checks
1. **Schema Validation**
   - Validate ACARDs against `schemas/acard.schema.json`.
   - Validate receipt envelopes against NIP-0002 (COSE/JOSE).
2. **Workflow Execution**
   - Publish a single-node workflow with a capability that echoes payload.
   - Verify node success and receipt presence (Profile 2+).
3. **Receipt Verification**
   - Verify sample receipt vector with published public key.
   - Verify receipts returned by `/v1/receipts/:taskId`.
4. **Discovery**
   - Discovery returns capability with profiles field.
   - Filter by minReputation works.
5. **Economics**
   - Capability pricing returned in discovery.
   - Budget guard rejects over-budget publish or dispatch.

## CI Integration
- Run:
  - `pnpm run validate:acard`
  - `pnpm run generate:receipt`
  - `pnpm --filter @nooterra/{types,registry,coordinator} type-check`
  - `pnpm --filter @nooterra/coordinator test`
- Add a small harness script that:
  - Spins up a test agent (mock), registers ACARD, runs publish→receipt→verify flow.
  - Fails if receipts missing or verify fails.

## Certification
- Passing the suite grants “Nooterra Core Compatible” for Profiles 0-3.
- Certification metadata can be added to ACARD `profiles[].certified=true` with a link to CI artifacts.
