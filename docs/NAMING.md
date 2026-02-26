# Naming Conventions

This repository distinguishes between:

1. **ACS workstream naming** (internal implementation tracks)
2. **Host/runtime identifiers** (external integration targets)

## ACS workstreams (internal)

Use `acs/*` naming in planning docs, roadmap docs, and implementation workstreams.

Examples:

- `acs/e02-session-backbone`
- `acs/e03-task-negotiation`
- `acs/e08-taint-governance`

## Host/runtime identifiers (external)

Keep runtime names exactly as required by integrations and tooling.

Examples:

- `nooterra`
- `claude`
- `cursor`
- `openclaw`

Do not rename host IDs in API payloads, CLI flags, tests, or onboarding configuration unless the upstream integration itself changes.

## Rule of thumb

- If a name is part of **our product architecture/planning**, use ACS naming.
- If a name is part of **external host compatibility**, keep the canonical host identifier.
