# Release Checklist

This checklist is the “no surprises” gate for shipping Nooterra as a product (not just a repo).

## Preconditions

- `npm test` is green on main.
- Main-branch release gate jobs are green in `.github/workflows/tests.yml` for the release commit:
  - `noo_44_47_48_regressions` (NOO-44/47/48 fail-closed regression lane)
  - `kernel_v0_ship_gate`
  - `production_cutover_gate`
  - `offline_verification_parity_gate` (NOO-50)
  - `release_promotion_materialization_chain` (NOO-65 input materialization + guard chain)
  - `onboarding_host_success_gate`
- Public package smoke for OpenClaw onboarding is green:
  - `npm run test:ci:public-openclaw-npx-smoke`
- `CHANGELOG.md` is updated and accurate.
- Protocol freeze gate is satisfied (no accidental schema/vector drift).
- Minimum production topology is defined for the target environment:
  - `docs/ops/MINIMUM_PRODUCTION_TOPOLOGY.md`
- Production deployment checklist is prepared for this release:
  - `docs/ops/PRODUCTION_DEPLOYMENT_CHECKLIST.md`
- Staging billing smoke secrets are configured for `.github/workflows/release.yml`:
  - `NOOTERRA_STAGING_BASE_URL`
  - `NOOTERRA_STAGING_OPS_TOKEN`
- npm publish secret is configured for `.github/workflows/release.yml` if you want direct registry distribution:
  - `NPM_TOKEN`
- Optional launch cutover packet signing inputs are configured for `.github/workflows/go-live-gate.yml` if signed packets are required:
  - secret: `LAUNCH_CUTOVER_PACKET_SIGNING_PRIVATE_KEY_PEM`
  - variable: `LAUNCH_CUTOVER_PACKET_SIGNATURE_KEY_ID`
- PyPI Trusted Publisher is configured for `.github/workflows/release.yml` and the `pypi` GitHub environment is allowed.
- PyPI Trusted Publisher is configured for `.github/workflows/python-pypi.yml` and the `pypi` GitHub environment is allowed (if using the Python-only lane).
- TestPyPI Trusted Publisher is configured for `.github/workflows/python-testpypi.yml` and the `testpypi` GitHub environment is allowed.

## Required release artifacts

For a protocol freeze release, the GitHub Release MUST include:

- npm tarballs (`*.tgz`) + `npm-SHA256SUMS`
  - includes `nooterra-*.tgz` (CLI distribution for `npx --package ... nooterra ...`)
  - optional registry publish lane (if `NPM_TOKEN` present) publishes `nooterra`, `nooterra-api-sdk`, `@nooterra/provider-kit`, and `create-nooterra-paid-tool`
- Python distributions (`*.whl`, `*.tar.gz`) + `python-SHA256SUMS`
- `conformance-v1.tar.gz` + `conformance-v1-SHA256SUMS`
- `nooterra-audit-packet-v1.zip` + `nooterra-audit-packet-v1.zip.sha256`
- `release_index_v1.json` + `release_index_v1.sig` (signed release manifest)
- `release-promotion-guard.json` (NOO-65 promotion guard report)

Release-gate evidence should also include:

- `billing-smoke-prod.log`
- `billing-smoke-status.json`
- `npm-postpublish-smoke-<version>` artifact (when `NPM_TOKEN` is configured), containing:
  - `provider-kit-npm-view-version.txt`
  - `create-nooterra-paid-tool-npm-view-version.txt`
  - `nooterra-npx-version.txt`
  - `nooterra-kernel-cases.txt`
  - `nooterra-help.txt`
  - `create-nooterra-paid-tool-help.txt`
  - `npm-postpublish-smoke.json`
- `artifacts/throughput/10x-drill-summary.json`
- `artifacts/gates/s13-go-live-gate.json`
- `artifacts/gates/s13-launch-cutover-packet.json`
- `artifacts/gates/nooterra-verified-collaboration-gate.json`
- when signing is configured, packet includes `signature` with `schemaVersion=LaunchCutoverPacketSignature.v1`
- `artifacts/gates/production-cutover-gate.json`
- `artifacts/gates/offline-verification-parity-gate.json` (NOO-50)
- `artifacts/gates/onboarding-host-success-gate.json`
- `artifacts/gates/release-promotion-guard.json` (NOO-65)

See `docs/spec/SUPPLY_CHAIN.md` for the release-channel threat model and verification posture.

## Local build + verification (recommended)

Build all artifacts locally:

```sh
python3 -m pip install --disable-pip-version-check --no-input build
node scripts/release/build-artifacts.mjs --out dist/release-artifacts
```

If you want to produce a locally-signed `ReleaseIndex.v1` too, provide a release signing key:

```sh
export NOOTERRA_RELEASE_SIGNING_PRIVATE_KEY_PEM="$(cat /path/to/release_ed25519_private_key.pem)"
node scripts/release/build-artifacts.mjs --out dist/release-artifacts --sign-release-index
```

Verify release checksums:

```sh
(cd dist/release-artifacts && sha256sum -c SHA256SUMS)
```

Validate conformance from the produced artifacts:

```sh
(cd dist/release-artifacts && tar -xzf conformance-v1.tar.gz)
node conformance-v1/run.mjs --node-bin packages/artifact-verify/bin/nooterra-verify.js
```

Validate release assets (checksums + archive contents):

```sh
node scripts/release/validate-release-assets.mjs --dir dist/release-artifacts
```

Verify release index signature + artifact hashes:

```sh
node scripts/release/verify-release.mjs --dir dist/release-artifacts --format json
```

Preferred operator CLI (same contract, packaged):

```sh
node packages/artifact-verify/bin/nooterra-release.js verify --dir dist/release-artifacts --trust-file trust/release-trust.json --format json --explain
```

## Release candidates

Use SemVer pre-release tags for RCs (e.g. `v1.0.0-rc.1`). RCs must meet the same artifact completeness and conformance gates as final releases.

Recommended Python dry-run before final tag release:

- Trigger `.github/workflows/python-testpypi.yml` with the target `version`.
- Confirm wheel/sdist publish succeeded on TestPyPI.
- Smoke-install from TestPyPI in a clean environment.

## Tag + release

- Create and push a tag: `vX.Y.Z`.
- The `release` workflow will:
  - build and attach npm artifacts + checksums
  - build and attach Python distribution artifacts + checksums
  - publish Python distributions to PyPI (Trusted Publishing/OIDC)
  - attach conformance pack + checksum
  - attach audit packet zip + checksum

## Kernel v0 ship gate

Before any Kernel v0 release candidate or public OSS push, run:

```sh
node scripts/ci/run-kernel-v0-ship-gate.mjs
```

Required report:

- `artifacts/gates/kernel-v0-ship-gate.json`

Runbook:

- `docs/ops/KERNEL_V0_SHIP_GATE.md`

## S13 launch gate (pre-cutover)

Before production cutover, run:

```sh
node scripts/ci/run-go-live-gate.mjs
```

Required gate reports:

- `artifacts/throughput/10x-drill-summary.json`
- `artifacts/throughput/10x-incident-rehearsal-summary.json`
- `artifacts/gates/production-cutover-gate.json`
- `artifacts/gates/s13-go-live-gate.json`
- `artifacts/gates/s13-launch-cutover-packet.json`
- Live deploy readiness run (manual workflow): `artifacts/gates/production-cutover-gate-prod.json`

Promotion guard order (fail-closed):

1. NOO-50 parity gate report is generated on main (`artifacts/gates/offline-verification-parity-gate.json`).
2. S13 go-live workflow report set is generated for the same release commit (`s13-go-live-gate.json` + `s13-launch-cutover-packet.json`).
3. Launch cutover packet must bind `sources.nooterraVerifiedCollaborationGateReportSha256` to the exact hash of
   `sources.nooterraVerifiedCollaborationGateReportPath`.
   - Packet must include `requiredCutoverChecks` (`ProductionCutoverRequiredChecksSummary.v1`) with pass/fail status for the 6 required production cutover checks.
   - NOO-65 promotion guard must verify `requiredCutoverChecks` status parity against `production-cutover-gate` required check statuses and fail-closed on mismatch.
4. NOO-65 promotion guard validates the launch-packet-to-collaboration binding and fail-closes on mismatch.
5. Release workflow binds all required gate artifacts (kernel, production cutover, NOO-50 parity, onboarding host success, S13 go-live, S13 launch packet, hosted baseline evidence) into NOO-65.
   - Production cutover must include `nooterra_verified_collaboration`, `openclaw_substrate_demo_lineage_verified`, `openclaw_substrate_demo_transcript_verified`, `checkpoint_grant_binding_verified`, `sdk_acs_smoke_js_verified`, `sdk_acs_smoke_py_verified`, and `sdk_python_contract_freeze_verified` as passed checks.
6. Release workflow must emit `artifacts/gates/release-promotion-guard.json` with `verdict.ok=true` before artifact publish jobs execute.
7. Release workflow must emit `artifacts/gates/release-cutover-audit-view.json` (`ReleaseCutoverAuditView.v1`) as the single merged verifier over production cutover gate, required-check assertion, and launch packet required-cutover summary.

Manual parity with CI materialization:

```sh
npm run -s test:ops:release-promotion-materialize-inputs -- \
  --tests-root /tmp/release-upstream/tests \
  --go-live-root /tmp/release-upstream/go-live \
  --release-gate-root /tmp/release-upstream/release-gate \
  --report artifacts/gates/release-promotion-guard-input-materialization.json
```

Then run NOO-65 guard against the materialized files:

```sh
npm run -s test:ops:release-promotion-guard -- \
  --report artifacts/gates/release-promotion-guard.json \
  --promotion-ref "<release-commit-sha>"
```

Related runbooks:

- `docs/ops/THROUGHPUT_DRILL_10X.md`
- `docs/ops/GO_LIVE_GATE_S13.md`
- `docs/ops/LIGHTHOUSE_PRODUCTION_CLOSE.md`
- `docs/ops/MCP_COMPATIBILITY_MATRIX.md`
