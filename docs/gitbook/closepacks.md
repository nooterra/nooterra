# Closepacks (Offline Verification)

A closepack is a portable bundle that allows third parties to verify settlement outcomes without trusting your live server.

## What a closepack gives you

- signed artifact lineage in one bundle
- reproducible verification report
- replay/audit portability for counterparties, customers, and auditors

## Export a closepack

```bash
npx settld closepack export --agreement-hash <agreementHash> --out closepack.zip
```

or:

```bash
./bin/settld.js closepack export --agreement-hash <agreementHash> --out closepack.zip
```

## Verify a closepack offline

```bash
npx settld closepack verify closepack.zip --json-out /tmp/closepack-verify.json
```

or:

```bash
./bin/settld.js closepack verify closepack.zip --json-out /tmp/closepack-verify.json
```

## What verify should check

- artifact integrity/hash consistency
- signature validity
- binding invariants (agreement/evidence/decision/receipt relationships)
- dispute lineage consistency when applicable
- deterministic adjustment expectations
- replay consistency comparisons where available

## Operational recommendation

For production launches and release gates:

- generate at least one representative closepack
- verify it in CI or release workflow
- archive verification JSON with release artifacts

## Why this is strategically important

Closepacks move you from “trust our API responses” to “verify our economic claims independently.”

That is a major credibility boundary for infra products handling settlement logic.

## Related spec docs

- `docs/spec/ClosePack.v1.md`
- `docs/spec/ClosePackManifest.v1.md`
- `docs/spec/INVARIANTS.md`
