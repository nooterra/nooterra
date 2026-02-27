# Nooterra API SDK (Python)

Python client for Nooterra API endpoints, including high-level helpers:
- core ACS object APIs:
  - `upsert_agent_card` / `list_agent_cards` / `get_agent_card`
  - `discover_agent_cards` / `discover_public_agent_cards` / `stream_public_agent_cards`
  - `get_public_agent_reputation_summary` / `get_agent_interaction_graph_pack` / `list_relationships`
  - `issue_delegation_grant` / `list_delegation_grants` / `get_delegation_grant` / `revoke_delegation_grant`
  - `issue_authority_grant` / `list_authority_grants` / `get_authority_grant` / `revoke_authority_grant`
  - `create_task_quote|offer|acceptance` + `list/get` variants
  - `create_work_order` + `list/get` + `accept|progress|top_up|get_work_order_metering|complete|settle` + receipt APIs
  - `create_state_checkpoint` / `list_state_checkpoints` / `get_state_checkpoint`
  - `create_session` / `list_sessions` / `get_session` / `list_session_events` / `append_session_event` / `stream_session_events` / `get_session_replay_pack` / `get_session_transcript`
  - `create_capability_attestation` / `list/get/revoke_capability_attestation`
- `first_verified_run` (register agents, run work, verify, settle)
- `first_paid_rfq` (rfq -> bid -> accept -> run -> settlement)
- tool-call kernel wrappers:
  - `create_agreement`
  - `sign_evidence`
  - `settle`
  - `create_hold`
  - `build_dispute_open_envelope`
  - `open_dispute`
  - `ops_get_tool_call_replay_evaluate`
  - `ops_get_reputation_facts`
  - `get_artifact` / `get_artifacts`
- run settlement/dispute lifecycle: `get_run_settlement_policy_replay`, `resolve_run_settlement`, `open_run_dispute`, `submit_run_dispute_evidence`, `escalate_run_dispute`, `close_run_dispute`
- `get_tenant_analytics` / `get_tenant_trust_graph`
- `list_tenant_trust_graph_snapshots` / `create_tenant_trust_graph_snapshot` / `diff_tenant_trust_graph`
- auth headers: `api_key` (Bearer), optional `x_api_key` (Magic Link), and optional `ops_token` (`x-proxy-ops-token`)

Quickstart docs:
- `docs/QUICKSTART_SDK_PYTHON.md` (Python first verified run + ACS substrate flow)
- `docs/QUICKSTART_SDK.md` (JS first verified run + ACS substrate flow)

Example commands:
- `npm run sdk:first-run:py`
- `npm run sdk:first-rfq:py`
- `npm run sdk:acs-smoke:py`

## Transport Parity Adapters (HTTP + MCP)

Use parity adapters when your integration must keep HTTP and MCP behavior aligned:

- `client.create_http_parity_adapter(...)`
- `client.create_mcp_parity_adapter(call_tool=..., ...)`

Quickstart:

```python
http_adapter = client.create_http_parity_adapter(
    max_attempts=2,
    retry_status_codes=[503],
    retry_delay_seconds=0,
)

mcp_adapter = client.create_mcp_parity_adapter(
    call_tool=call_tool,
    max_attempts=2,
    retry_status_codes=[503],
    retry_delay_seconds=0,
)

http_operation = {
    "operationId": "run_dispute_evidence_submit",
    "method": "POST",
    "path": "/runs/run_1/dispute/evidence",
    "requiredFields": ["disputeId", "evidenceRef"],
    "idempotencyRequired": True,
    "expectedPrevChainHashRequired": True,
}

mcp_operation = {
    "operationId": "run_dispute_evidence_submit",
    "toolName": "nooterra.run_dispute_evidence_submit",
    "requiredFields": ["disputeId", "evidenceRef"],
    "idempotencyRequired": True,
    "expectedPrevChainHashRequired": True,
}

http_adapter.invoke(
    http_operation,
    payload,
    idempotency_key="idem_run_1_dispute_evidence",
    expected_prev_chain_hash=prev_chain_hash,
)
mcp_adapter.invoke(
    mcp_operation,
    payload,
    idempotency_key="idem_run_1_dispute_evidence",
    expected_prev_chain_hash=prev_chain_hash,
)
```

Reuse the same idempotency key across retries, and pass `expected_prev_chain_hash` for chain-bound writes. Missing either fails closed with `PARITY_*`.

Both adapters return the same envelope:
- `ok`, `status`, `requestId`, `body`, `headers`
- `transport`, `operationId`, `idempotencyKey`, `attempts`

Both adapters raise `NooterraParityError` with stable fields:
- `status`, `code`, `message`, `details`, `requestId`
- `retryable`, `attempts`, `transport`, `operationId`

Safety caveats for integration:
- Treat `PARITY_*` validation codes as fail-closed and stop the flow.
- Idempotency is fail-closed by default (`idempotencyRequired=True`). Set `idempotencyRequired=False` only for explicitly safe read operations.
- For safety-critical writes, reuse the same idempotency key for retries.
- Require `expected_prev_chain_hash` for chain-bound writes (`expectedPrevChainHashRequired=True`).
- Keep retry policy deterministic and avoid adding a transport-specific retry path outside the parity adapter.
