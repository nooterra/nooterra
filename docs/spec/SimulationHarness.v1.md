# SimulationHarness.v1

`SimulationHarness.v1` defines deterministic primitives for S8 simulation and personal-agent ecosystem runs.

## Contracts

- Harness schema: `NooterraSimulationHarness.v1`
- Run schema: `NooterraSimulationRun.v1`
- Scenario schema: `NooterraPersonalAgentEcosystemScenario.v1`
- Scenario DSL schema: `NooterraSimulationScenarioDsl.v1`
- Fault matrix schema: `NooterraSimulationFaultMatrix.v1`

## Inputs

- `scenarioId`: stable scenario identifier.
- `seed`: deterministic seed for stable IDs and hashes.
- `actions[]`: ordered action list with agent, manager, ecosystem, risk, and cost fields.
- `approvalPolicy`: high-risk threshold and strict evidence rules.
- `approvalsByActionId`: optional map of explicit human approvals.
- `invariantHooks[]`: optional deterministic invariant checks for automatic pass/fail verdicting.

## Scenario DSL

`NooterraSimulationScenarioDsl.v1` provides a diffable, seed-driven way to generate concrete scenarios:

- `actorRoles[]`: role definitions (`roleId`, `count`) used to deterministically mint actor IDs from seed material.
- `flow[]`: ordered action templates (`roleId`, `actionType`, `riskTier`, `amountCents`, `metadata`).
- `invariants[]`: optional post-run verdict hooks:
  - `blocked_actions_at_most`
  - `high_risk_actions_at_most`
  - `all_checks_passed`

Compiling the DSL must be deterministic for identical input and seed.

## Fault-Injection Matrix

`NooterraSimulationFaultMatrix.v1` defines deterministic multi-fault evaluation for distributed and economic failure modes.

Baseline supported fault types:

- `network_partition`
- `retry_storm`
- `stale_cursor`
- `signer_failure`
- `settlement_race`
- `economic_abuse`

Each fault result must include:

- a stable fault hash (`faultSha256`)
- deterministic reason-code-family checks
- explicit recovery validation checks

If a fault lacks recovery validation, matrix output must fail closed with `SIM_RECOVERY_NOT_VALIDATED`.

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
- Invariant hook failures must emit `SIMULATION_INVARIANT_FAILED` and block strict pass verdicts.

## Determinism requirements

- Stable IDs must derive from deterministic seed material.
- Hashes must use canonical JSON + `sha256`.
- Re-running with identical scenario, approvals, seed, and timestamps must produce byte-stable semantic output.
