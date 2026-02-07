# SlaEvaluation.v1

`SlaEvaluation.v1` is a deterministic evaluation of `SlaDefinition.v1` against a specific JobProof instance.

In ClosePack bundles, it is stored at `sla/sla_evaluation.json`.

## Determinism contract

If `sla/sla_definition.json` and `sla/sla_evaluation.json` are present, verifiers recompute the evaluation from the embedded JobProof event stream and require **exact match** (canonical JSON) in strict mode.

The evaluation must not depend on external systems or evidence bytes.

