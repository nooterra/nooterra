# Launch Readiness Scorecard

Settld launch readiness is gated by binary pass/fail checks, not subjective confidence.

## Decision Rules

- `GO`: all P0 gates pass and >= 80% of P1 gates pass.
- `CONDITIONAL GO`: all P0 gates pass and 60-79% of P1 gates pass with explicit mitigations.
- `NO GO`: any P0 gate fails.

## P0 Gates

1. Onboarding quality (no dead-end failures, deterministic quick-mode flow)
2. Runtime trust enforcement (no policy bypass for paid actions)
3. Financial integrity (idempotent reserve/settle/reverse flows)
4. Evidence determinism (offline verification reproducible)
5. Security baseline (tenant isolation + secret hygiene + authz boundaries)

## P1 Gates

1. SRE baseline (SLOs and rollback drills)
2. Operator controls (escalation, pause, signed override)
3. Compliance exports (finance/risk review packet)
4. Abuse resilience (adversarial scenarios)
5. Growth readiness (activation and supportability)

## Required Evidence

- `artifacts/ops/mcp-host-smoke.json`
- `artifacts/gates/x402-circle-sandbox-smoke.json`
- launch gate report and rollback drill report
- sample receipt verification and closepack outputs

## Full Operating Scorecard

For full gate definitions, ownership, and weekly cadence:

- `planning/trust-os-v1/state-of-the-art-launch-readiness-scorecard.md`
