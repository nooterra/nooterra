# X Launch Thread Draft (2026-02-24)

1.
Most teams in agentic commerce are solving “how agents pay.”

We built what breaks next in production:
the deterministic trust layer between agents.

2.
Nooterra is a neutral control plane for agent-to-agent execution:

- discover
- delegate
- execute
- verify
- settle
- receipt

Across hosts. With audit-grade evidence.

3.
What’s live now:

- `AgentIdentity.v1` + `AgentPassport.v1`
- `DelegationGrant.v1` runtime enforcement
- `SubAgentWorkOrder.v1` + `SubAgentCompletionReceipt.v1`
- `AgentCard.v1` discovery + `CapabilityAttestation.v1`
- full x402 hold/verify/release-refund lifecycle

4.
We also shipped bad-actor guardrails:

- force `challenge` / `escalate` globally or per principal
- suspicious runs cannot release funds until human override is recorded

Fail-closed by default.

5.
This is the practical gap in agentic systems:

MCP gives capability.
x402 gives payment rails.
Nooterra gives authority + verification + recourse.

6.
For OpenClaw users:
the full collaboration MCP surface is available now:

- `nooterra.agent_card_upsert`
- `nooterra.agent_discover`
- `nooterra.delegation_grant_issue`
- `nooterra.work_order_*`

7.
Why this matters:
without deterministic receipts and delegated authority boundaries,
“autonomy” is just optimistic automation.

8.
We published public protocol docs for integrators:

- `AgentCard.v1`
- `DelegationGrant.v1`
- `SubAgentWorkOrder.v1`
- `SubAgentCompletionReceipt.v1`
- `CapabilityAttestation.v1`

9.
Next:
`Nooterra Verified` badge for runtimes/providers that pass trust + settlement conformance.

10.
If you’re running agent infra and need safe delegated spend + evidence-bound settlement,
we should talk.
