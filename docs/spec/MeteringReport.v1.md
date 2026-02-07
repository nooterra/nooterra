# MeteringReport.v1

This report is stored at `metering/metering_report.json` within Invoice bundles.

## Binding to an embedded JobProof bundle

To prevent replay/mix-and-match, the report must bind to the embedded JobProof instance:

- `jobProof.embeddedPath` (constant path within the Invoice bundle)
- `jobProof.manifestHash`
- `jobProof.headAttestationHash`

Verifiers must require that any `evidenceRefs[]` entries (path + sha256) match the embedded JobProof bundle’s manifest.

## Numeric representation

- `quantity` values are base-10 integer strings (no floats).

