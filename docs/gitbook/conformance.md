# Conformance

Conformance ensures your implementation satisfies Kernel v0 behavioral guarantees, not just schema shape.

## Why conformance matters

Passing conformance proves the economic loop is correct under replay, disputes, and deterministic adjustment handling.

It catches regressions that simple unit tests often miss.

## Run conformance

### Installed CLI

```bash
npx settld conformance kernel --ops-token tok_ops --json-out /tmp/kernel-report.json
```

### Repo checkout

```bash
./bin/settld.js conformance kernel --ops-token tok_ops --json-out /tmp/kernel-report.json
```

## What it should validate

At minimum, your conformance run should verify:

- settlement artifact chain generation
- replay-evaluate consistency checks
- closepack export + offline verify roundtrip
- dispute flow integration with holdback freeze behavior
- deterministic/idempotent adjustment application constraints

## CI usage

Run conformance in CI and store artifacts:

- JSON report output
- closepack verification output (if generated)
- release metadata/checksums where applicable

This makes release confidence auditable.

## Run twice rule

A good idempotency signal is running critical flows twice and verifying no duplicate side effects where deterministic uniqueness is expected.

## Failure handling

When conformance fails:

1. Identify failing assertion from report JSON.
2. Map failure to primitive/invariant (agreement binding, dispute state, adjustment uniqueness, replay mismatch, etc.).
3. Fix at invariant layer (not only endpoint response shape).
4. Re-run until green.

## Related files

- `conformance/kernel-v0/run.mjs`
- `test/conformance-kernel-v0.test.js`
- `docs/KERNEL_COMPATIBLE.md`
