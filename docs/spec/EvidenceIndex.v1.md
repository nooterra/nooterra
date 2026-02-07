# EvidenceIndex.v1

`EvidenceIndex.v1` is a deterministic, audit-friendly index of evidence references implied by:

- the embedded JobProof event stream (evidence capture events), and
- the embedded Invoice bundle’s metering evidence references (file paths + hashes).

In ClosePack bundles, it is stored at `evidence/evidence_index.json`.

## Purpose

The index exists so consumers (buyers, auditors) can quickly answer:

- “What evidence exists for this job?”
- “Which in-bundle files were referenced for billing math?”

## Privacy posture

Evidence references may contain sensitive URLs. ClosePack indexes should avoid embedding secrets directly; use hashes where appropriate.

