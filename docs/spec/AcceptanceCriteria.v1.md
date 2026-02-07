# AcceptanceCriteria.v1

`AcceptanceCriteria.v1` defines buyer-side acceptance rules that can be evaluated deterministically and offline from a JobProof-derived job stream.

In ClosePack bundles, it is stored at `acceptance/acceptance_criteria.json`.

## Criteria kinds (v1)

Each criterion has:

- `criterionId` — stable identifier (string).
- `kind` — one of:
  - `PROOF_STATUS_EQUALS`
  - `SLA_OVERALL_OK`

Criteria are evaluated from embedded JobProof facts and (optionally) an `SlaEvaluation.v1`.

