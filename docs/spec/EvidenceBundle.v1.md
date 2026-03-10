# EvidenceBundle.v1

`EvidenceBundle.v1` defines the canonical Action Wallet evidence submission captured before finalize.

In launch v1 this object is represented by the evidence payload posted to `/v1/execution-grants/{executionGrantId}/evidence` and the normalized evidence refs retained on the materialized work order and completion receipt.

## Purpose

- freeze the host-submitted proof set that supports final verification;
- provide one stable object shape for evidence refs, progress context, and submission time;
- keep evidence submission auditable even before a dedicated standalone evidence store exists.

## Projection semantics

- `executionGrantId` identifies the public grant the evidence applies to.
- `workOrderId` binds the bundle to the host-executed materialized action when present.
- `evidenceRefs` is the deterministic, ordered proof list used during finalize.
- `evidenceBundleHash` is the stable semantic hash over the Action Wallet evidence set and optional execution-attestation linkage.
- `executionAttestationRef` binds the bundle to an attested execution artifact when one exists.
- `submittedAt` records when the bundle crossed the Action Wallet boundary.

This object is a v1 projection over the evidence-submit request body and stored work-order / completion-receipt evidence refs. It does not create a new stored aggregate yet.

## Required fields

- `schemaVersion` (const: `EvidenceBundle.v1`)
- `executionGrantId`
- `evidenceRefs`
- `submittedAt`

## Optional fields

- `workOrderId`
- `progressId`
- `eventType`
- `message`
- `percentComplete`
- `executionAttestationRef`
- `at`
- `evidenceBundleHash`

## Schema

See `schemas/EvidenceBundle.v1.schema.json`.
