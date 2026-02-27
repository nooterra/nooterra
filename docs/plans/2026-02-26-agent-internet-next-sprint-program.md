# ACS Next Sprint Program (Internet of Agents)

Date: 2026-02-26

## 1) Product Thesis
Nooterra is building the trust kernel for an internet of agents: policy, evidence, and settlement are cryptographically bound, and exposed through open schemas/APIs so any runtime can discover, delegate, collaborate, and settle with replayable receipts.

Strategic position for this sprint:
1. Trust OS kernel is shipped and operational, not static.
2. Protocol stays host-neutral.
3. Distribution is OpenClaw-first as reference, while integrations remain runtime-neutral.

## 2) Program Layer for This Sprint
Program parent:
1. `NOO-144` PROGRAM: Nooterra Agent Collaboration Substrate Buildout.

Macro execution tracks:
1. `NOO-218` ACS-NS1: Interop and Trust Identity Baseline.
2. `NOO-219` ACS-NS2: Agent Inbox Reliability and Session Delivery.
3. `NOO-220` ACS-NS3: Evidence-Bound Settlement and Reversal Integrity.
4. `NOO-221` ACS-NS4: Federation and Namespace Control Plane.
5. `NOO-222` ACS-NS5: OpenClaw-First Distribution and Operator Readiness.

Dependency order (configured in Linear):
1. `NOO-218` blocks `NOO-219` and `NOO-220`.
2. `NOO-219` and `NOO-220` block `NOO-221`.
3. `NOO-221` blocks `NOO-222`.

## 3) Mapping to Existing ACS Workstreams
1. Discovery, authority, conformance, key lifecycle:
`NOO-145`, `NOO-146`, `NOO-154`, `NOO-217`.
2. Session backbone, negotiation, replay, inbox semantics:
`NOO-147`, `NOO-148`, `NOO-156`, `NOO-216`.
3. Settlement, work orders, relationship signals, disputes:
`NOO-149`, `NOO-150`, `NOO-152`, `NOO-151`.
4. Governance/federation hardening:
`NOO-153`, `NOO-154`, `NOO-217`.
5. Distribution and operator readiness:
`NOO-155` plus E08/E09 controls.

## 4) Sprint KPI Contract
1. Interop adoption:
At least one non-Nooterra runtime passes deterministic conformance and publishes cert artifacts.
2. Session reliability:
Zero silent gaps and zero duplicate-finalized events in retry/offline stress cases.
3. Settlement safety:
Zero paid-path completions without evidence-chain validation.
4. Replay validity:
Deterministic replay verification success for certified fixtures.
5. Operator readiness:
Documented path to first policy-compliant delegated settled run in under 15 minutes.

## 5) Non-Negotiables for All Tracks
1. No bypass paths around policy/runtime enforcement.
2. Fail closed on missing, invalid, or mismatched evidence/artifacts.
3. Deterministic machine-readable artifacts for gate decisions.
4. Backward-safe protocol changes only.
5. No unrelated refactors in ticket-scoped work.

## 6) Execution Log
Completed slice:
1. `NOO-223` ACS-NS1/T1 (Done).
2. Commit: `3540f87` on `acs/substrate-lineage-gates`.
3. Delivered:
- `conformance/v1/run.mjs`: `--json-out` and `--cert-bundle-out` with deterministic hash binding.
- `conformance/v1/README.md`: artifact contract and usage updates.
- `test/conformance-pack-v1-cert-bundle.test.js`: regression coverage.
4. Validation:
- `node --check conformance/v1/run.mjs`
- `node --test test/conformance-pack-v1-cert-bundle.test.js`
- `node --test test/conformance-pack-v1.test.js`

Completed slice:
1. `NOO-218` ACS-NS1 key lifecycle conformance expansion (Done).
2. Delivered:
- `conformance/v1/release-cases.json`: added fail-closed trust-window/rotation cases (`release_fail_signer_not_yet_valid`, `release_fail_rotated_out_signer`) and rotated-signer pass case (`release_pass_rotated_signer`).
- `conformance/v1/release-trust-not-yet-valid.json`: deterministic signer `notBeforeEpochSeconds` fail vector.
- `conformance/v1/release-trust-rotation-window.json`: deterministic rotation cutover trust vector.
- `conformance/v1/releases/release_pass_rotated_signer/*`: rotated-in signer fixture.
- `docs/spec/INVARIANTS.md`: `REL-007` contract for signer time-window/rotation enforcement.
3. Validation:
- `node --test test/conformance-pack-release-v1.test.js test/conformance-invariants-traceability.test.js`

Completed slice:
1. `NOO-219` ACS-NS2 session stream conformance pack bootstrap (Done).
2. Delivered:
- `conformance/session-stream-v1/run.mjs`: deterministic stream semantics harness with report/cert outputs.
- `conformance/session-stream-v1/vectors.json`: cursor conflict, missing cursor fail-closed, watermark progression, reconnect dedupe vectors.
- `conformance/session-stream-v1/reference/nooterra-session-stream-runtime-adapter.mjs`: reference adapter contract implementation.
- `test/conformance-session-stream-v1.test.js`: pack smoke coverage.
- `test/conformance-session-stream-v1-cert-bundle.test.js`: hash-bound report/cert-bundle coverage.
- `conformance/README.md`: pack index updated.
3. Validation:
- `node --test test/conformance-session-stream-v1.test.js test/conformance-session-stream-v1-cert-bundle.test.js`

Completed slice:
1. `NOO-220` ACS-NS2 session stream conformance release-gate wiring (Done).
2. Delivered:
- `scripts/ci/run-nooterra-verified-gate.mjs`: added `e2e_session_stream_conformance_v1` source check.
- `scripts/ci/run-production-cutover-gate.mjs`: derives `session_stream_conformance_verified` from `nooterra_verified_collaboration`.
- `scripts/ci/assert-production-cutover-required-checks.mjs`: required-check default set now includes session stream conformance verification.
- `scripts/ci/build-launch-cutover-packet.mjs`: required-cutover summary now binds `session_stream_conformance_verified` to source `e2e_session_stream_conformance_v1`.
- `scripts/ci/run-release-promotion-guard.mjs`: launch-packet binding now fail-closes on missing/not-passed session stream conformance check.
- `scripts/release/build-release-notes-from-gates.mjs` and `scripts/release/build-cutover-audit-view.mjs`: required-check surfaces include session stream conformance.
3. Validation:
- `node --test test/nooterra-verified-gate-script.test.js test/production-cutover-gate-script.test.js`
- `node --test test/assert-production-cutover-required-checks-script.test.js test/launch-cutover-packet-script.test.js`
- `node --test test/release-promotion-guard-script.test.js test/release-promotion-guard-e2e-materialized.test.js`
- `node --test test/build-release-notes-from-gates-script.test.js test/release-cutover-audit-view-script.test.js test/release-workflow-contract.test.js`

Completed slice:
1. `NOO-221` ACS-NS2 third-party adapter onboarding + cert publication workflow (Done).
2. Delivered:
- `scripts/conformance/publish-session-stream-conformance-cert.mjs`: fail-closed publication script that runs `session-stream-v1`, validates hash/core bindings, and emits normalized report/cert/publication artifacts.
- `test/session-stream-conformance-publication-script.test.js`: deterministic publication + fail-closed argument validation coverage.
- `.github/workflows/session-stream-conformance-cert.yml`: manual publication lane emitting runtime-scoped cert artifacts.
- `conformance/session-stream-v1/README.md`: onboarding + publication procedure.
- `docs/spec/REFERENCE_IMPLEMENTATIONS.md` and `docs/gitbook/conformance.md`: operator-facing commands for publication workflow.
3. Validation:
- `node --test test/session-stream-conformance-publication-script.test.js`

## 7) Immediate Next Build Items
1. NS3: tighten settlement/dispute evidence binding checks for edge-case reversals.
2. NS3: add dispute-time replay/lineage parity checks for reversal adjudication.
3. NS3: add settlement/dispute cert-bundle publication checks into release note and cutover summaries.
