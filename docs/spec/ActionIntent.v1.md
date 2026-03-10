# ActionIntent.v1

`ActionIntent.v1` defines the public Action Wallet alias returned by `/v1/action-intents`.

It is a projection over `AuthorityEnvelope.v1` plus host metadata and approval-link context for one host-initiated action.

## Purpose

- expose the initiating host request in launch-language (`buy` / `cancel/recover`);
- bind the public action handle back to the canonical `AuthorityEnvelope.v1`;
- carry the approval-link and host-channel context needed by the hosted approval UI.

## Alias semantics

- `actionIntentId` is the same identifier as `authorityEnvelopeRef.envelopeId`.
- `intentHash` is the stable semantic hash for the v1 action intent and resolves directly from `authorityEnvelopeRef.envelopeHash`.
- `authorityEnvelopeRef` binds the alias to the canonical `AuthorityEnvelope.v1`.
- `approvalRequestRef` is populated only after an approval request exists.
- `host` captures host-channel metadata for the launch channels (`Claude MCP`, `OpenClaw`).

This object is intentionally an alias in v1. It does not create a separate stored aggregate.

## Lifecycle

`status` follows the frozen Action Wallet intent state machine in `ActionIntentLifecycle.v1.md`.

## Required fields

- `schemaVersion` (const: `ActionIntent.v1`)
- `actionIntentId`
- `status`
- `createdAt`
- `purpose`
- `principalRef`
- `actor`
- `authorityEnvelopeRef`

## Optional fields

- `intentHash`
- `capabilitiesRequested`
- `dataClassesRequested`
- `sideEffectsRequested`
- `spendEnvelope`
- `reversibilityClass`
- `riskClass`
- `evidenceRequirements`
- `approvalRequestRef`
- `approvalUrl`
- `host`

## Schema

See `schemas/ActionIntent.v1.schema.json`.
