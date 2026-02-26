# Settld API SDK (Python)

Python client for Settld API endpoints, including high-level helpers:
- core ACS object APIs:
  - `upsert_agent_card` / `list_agent_cards` / `get_agent_card`
  - `discover_agent_cards` / `discover_public_agent_cards`
  - `issue_delegation_grant` / `list_delegation_grants` / `get_delegation_grant` / `revoke_delegation_grant`
  - `issue_authority_grant` / `list_authority_grants` / `get_authority_grant` / `revoke_authority_grant`
  - `create_task_quote|offer|acceptance` + `list/get` variants
  - `create_work_order` + `list/get` + `accept|progress|complete|settle` + receipt APIs
  - `create_session` / `append_session_event` / `get_session_replay_pack` / `get_session_transcript`
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

Quickstart docs live in `docs/QUICKSTART_SDK_PYTHON.md` at repo root.
