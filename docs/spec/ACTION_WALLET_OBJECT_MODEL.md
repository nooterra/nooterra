# Action Wallet V1 Object Model

Machine-readable source of truth: [`action-wallet-v1-object-model.json`](./action-wallet-v1-object-model.json)

This file freezes how the nine launch objects map to the current runtime and persistence layer.

The key v1 rule is unchanged: the Action Wallet publishes public launch-language objects, but several of them are aliases or projections over older substrate records that remain the canonical stored source of truth.

| Launch object | Schema | Canonical substrate | Persistence binding |
| --- | --- | --- | --- |
| Action Intent | `ActionIntent.v1` | `AuthorityEnvelope.v1` | `authorityEnvelopes` map / `snapshots.aggregate_type='authority_envelope'` |
| Approval Request | `ApprovalRequest.v1` | `ApprovalRequest.v1` | `approvalRequests` map / `snapshots.aggregate_type='approval_request'` |
| Approval Decision | `ApprovalDecision.v1` | `ApprovalDecision.v1` | `approvalDecisions` map / `snapshots.aggregate_type='approval_decision'` |
| Execution Grant | `ExecutionGrant.v1` | `ApprovalContinuation.v1` + `SubAgentWorkOrder.v1` | derived from approval + work-order records at read time |
| Evidence Bundle | `EvidenceBundle.v1` | `SubAgentWorkOrder.v1` + `SubAgentCompletionReceipt.v1` | derived from evidence submit payload and stored evidence refs |
| Receipt | `ActionReceipt.v1` | `SubAgentCompletionReceipt.v1` + `SettlementReceipt.v1` | `subAgentCompletionReceipts` plus settlement detail at read time |
| Dispute Case | `DisputeCase.v1` | `ArbitrationCase.v1` + `AgentRunSettlement.v1` | `arbitrationCases` plus settlement dispute context |
| Standing Rule | `ApprovalStandingPolicy.v1` | `ApprovalStandingPolicy.v1` | `approvalStandingPolicies` map / `snapshots.aggregate_type='approval_standing_policy'` |
| Settlement Event | `SettlementEvent.v1` | `AgentRunSettlement.v1` + `SettlementReceipt.v1` | derived from `agent_run_settlements` and hosted receipt detail |

All object entries in the machine-readable manifest must have:

- a schema doc,
- a JSON schema file,
- explicit runtime bindings,
- explicit persistence bindings, and
- zero unresolved field questions.
