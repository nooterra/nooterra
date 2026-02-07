# AcceptanceEvaluation.v1

`AcceptanceEvaluation.v1` is a deterministic evaluation of `AcceptanceCriteria.v1` against a specific JobProof instance.

In ClosePack bundles, it is stored at `acceptance/acceptance_evaluation.json`.

## Determinism contract

If `acceptance/*` surfaces are present, verifiers recompute the evaluation and require exact match (canonical JSON) in strict mode.

