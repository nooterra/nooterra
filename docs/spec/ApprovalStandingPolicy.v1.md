# ApprovalStandingPolicy.v1

`ApprovalStandingPolicy.v1` defines the canonical standing-rule artifact used by the Action Wallet policy layer.

It captures reusable bounded approval policy for a principal, host, and action class.

## Purpose

- let users pre-authorize low-risk, bounded action classes;
- force explicit approval for actions that remain outside the rule;
- preserve a deterministic rule artifact that the policy engine can replay.

## Required fields

- `schemaVersion` (const: `ApprovalStandingPolicy.v1`)
- `policyId`
- `principalRef`
- `displayName`
- `status`
- `constraints`
- `decision`
- `createdAt`
- `policyHash`

## Optional fields

- `description`
- `updatedAt`

## Schema

See `schemas/ApprovalStandingPolicy.v1.schema.json`.
