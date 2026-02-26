# ArtifactRef.v1

`ArtifactRef.v1` is the canonical pointer format for hash-addressed artifacts used across ACS objects.

Runtime status: implemented.

## Purpose

Provide a deterministic, portable reference to immutable evidence/state payloads without embedding large blobs in control-plane objects.

## Required fields

- `schemaVersion` (const: `ArtifactRef.v1`)
- `artifactId`
- `artifactHash` (`sha256` hex, lowercase)

## Key optional fields

- `artifactType`
- `tenantId`
- `metadata`

## Invariants

- `artifactHash` must be 64-char lowercase hex.
- canonical JSON normalization is required for deterministic hashing/binding when embedded in other schemas.
- `artifactId` is stable logical identity; `artifactHash` is immutable content binding.

## API surface

- embedded by other substrate objects (no standalone endpoint in v1)

## MCP surface

- embedded by state-checkpoint tools

## Implementation references

- `src/core/artifact-ref.js`
- `src/core/state-checkpoint.js`
