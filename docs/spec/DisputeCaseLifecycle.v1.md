# DisputeCase Lifecycle v1

This document freezes the dispute + arbitration lifecycle transitions enforced by Trust OS v1.

## Run dispute lifecycle

State machine (`AgentRunSettlement.v1`):

- `none -> open`
- `closed -> open`
- `open -> closed`

Invalid transitions are fail-closed and return stable conflict codes (`TRANSITION_ILLEGAL`).

Guard rules:

- Dispute open requires settlement to be unresolved (`status=locked`) and inside dispute window.
- Dispute close requires an active open dispute id match.
- Dispute evidence/escalation updates require an active open dispute.

## Arbitration case lifecycle

State machine (`ArbitrationCase.v1`):

- `open -> under_review`
- `under_review -> verdict_issued`
- `verdict_issued -> closed`

Invalid transitions are fail-closed and return `TRANSITION_ILLEGAL`.

Guard rules:

- Arbitration open requires the parent settlement dispute to be open.
- Verdict issuance is denied outside `open|under_review`.
- Case close is denied unless current status is `verdict_issued`.
- Appeal/open/close actions are denied after dispute window expiration (`DISPUTE_WINDOW_EXPIRED`).

## Determinism requirements

- Panel assignment uses canonicalized sorted candidate ids and deterministic hash selection.
- Re-ordering `panelCandidateAgentIds` must not change `assignmentHash` or chosen arbiter.
- Transition denials and window denials emit stable machine codes for replay/automation.
