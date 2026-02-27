# SimulationHarness.v1

`SimulationHarness.v1` defines deterministic primitives for S8 simulation and personal-agent ecosystem runs.

## Contracts

- Harness schema: `NooterraSimulationHarness.v1`
- Run schema: `NooterraSimulationRun.v1`
- Scenario schema: `NooterraPersonalAgentEcosystemScenario.v1`

## Inputs

- `scenarioId`: stable scenario identifier.
- `seed`: deterministic seed for stable IDs and hashes.
- `actions[]`: ordered action list with agent, manager, ecosystem, risk, and cost fields.
- `approvalPolicy`: high-risk threshold and strict evidence rules.
- `approvalsByActionId`: optional map of explicit human approvals.

## Output

Simulation run output MUST include:

1. `schemaVersion`
2. `summary` (total/high-risk/approved/blocked counts)
3. `checks[]` (machine-readable pass/fail checks)
4. `blockingIssues[]` (explicit fail-closed reasons)
5. `actionResults[]` (per-action approval decision details)
6. `runSha256` (canonical-hash binding of run core)

## Fail-closed behavior

- High-risk actions require explicit human approval.
- Missing, invalid, mismatched, or expired approvals block action execution.
- Strict evidence mode blocks approvals that have no evidence references.
- Blocking decisions must be emitted as deterministic reason codes.

## Determinism requirements

- Stable IDs must derive from deterministic seed material.
- Hashes must use canonical JSON + `sha256`.
- Re-running with identical scenario, approvals, seed, and timestamps must produce byte-stable semantic output.

