from __future__ import annotations

import json
import random
import time
import uuid
from typing import Any, Dict, Optional
from urllib import error, parse, request


def _assert_non_empty_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _random_request_id() -> str:
    return f"req_{uuid.uuid4().hex}"


def _normalize_prefix(value: Optional[str], fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


class SettldApiError(Exception):
    def __init__(
        self,
        *,
        status: int,
        message: str,
        code: Optional[str] = None,
        details: Any = None,
        request_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details
        self.request_id = request_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "code": self.code,
            "message": str(self),
            "details": self.details,
            "requestId": self.request_id,
        }


class SettldClient:
    def __init__(
        self,
        *,
        base_url: str,
        tenant_id: str,
        protocol: str = "1.0",
        api_key: Optional[str] = None,
        x_api_key: Optional[str] = None,
        user_agent: Optional[str] = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.base_url = _assert_non_empty_string(base_url, "base_url").rstrip("/")
        self.tenant_id = _assert_non_empty_string(tenant_id, "tenant_id")
        self.protocol = protocol
        self.api_key = api_key
        self.x_api_key = x_api_key
        self.user_agent = user_agent
        self.timeout_seconds = timeout_seconds

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        expected_prev_chain_hash: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict[str, Any]:
        rid = request_id if request_id else _random_request_id()
        headers = {
            "content-type": "application/json",
            "x-proxy-tenant-id": self.tenant_id,
            "x-settld-protocol": self.protocol,
            "x-request-id": rid,
        }
        if self.user_agent:
            headers["user-agent"] = self.user_agent
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        if self.x_api_key:
            headers["x-api-key"] = str(self.x_api_key)
        if idempotency_key:
            headers["x-idempotency-key"] = str(idempotency_key)
        if expected_prev_chain_hash:
            headers["x-proxy-expected-prev-chain-hash"] = str(expected_prev_chain_hash)

        url = parse.urljoin(f"{self.base_url}/", path.lstrip("/"))
        payload = None if body is None else json.dumps(body).encode("utf-8")
        req = request.Request(url=url, data=payload, method=method, headers=headers)
        timeout = self.timeout_seconds if timeout_seconds is None else timeout_seconds
        try:
            with request.urlopen(req, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
                parsed = None
                if raw:
                    try:
                        parsed = json.loads(raw)
                    except json.JSONDecodeError:
                        parsed = {"raw": raw}
                response_headers = {str(k).lower(): str(v) for k, v in response.headers.items()}
                return {
                    "ok": True,
                    "status": int(response.status),
                    "requestId": response_headers.get("x-request-id"),
                    "body": parsed,
                    "headers": response_headers,
                }
        except error.HTTPError as http_error:
            raw = http_error.read().decode("utf-8")
            parsed: Any = {}
            if raw:
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    parsed = {"raw": raw}
            response_headers = {str(k).lower(): str(v) for k, v in http_error.headers.items()}
            raise SettldApiError(
                status=int(http_error.code),
                code=parsed.get("code") if isinstance(parsed, dict) else None,
                message=parsed.get("error", f"request failed ({http_error.code})") if isinstance(parsed, dict) else f"request failed ({http_error.code})",
                details=parsed.get("details") if isinstance(parsed, dict) else None,
                request_id=response_headers.get("x-request-id"),
            ) from http_error

    def register_agent(self, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        if not isinstance(body, dict):
            raise ValueError("body is required")
        _assert_non_empty_string(body.get("publicKeyPem"), "body.publicKeyPem")
        return self._request("POST", "/agents/register", body=body, **opts)

    def credit_agent_wallet(self, agent_id: str, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(agent_id, "agent_id")
        if not isinstance(body, dict):
            raise ValueError("body is required")
        return self._request("POST", f"/agents/{parse.quote(agent_id, safe='')}/wallet/credit", body=body, **opts)

    def get_agent_wallet(self, agent_id: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(agent_id, "agent_id")
        return self._request("GET", f"/agents/{parse.quote(agent_id, safe='')}/wallet", **opts)

    def create_agent_run(self, agent_id: str, body: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(agent_id, "agent_id")
        run_body = {} if body is None else body
        if not isinstance(run_body, dict):
            raise ValueError("body must be an object")
        return self._request("POST", f"/agents/{parse.quote(agent_id, safe='')}/runs", body=run_body, **opts)

    def append_agent_run_event(
        self,
        agent_id: str,
        run_id: str,
        body: Dict[str, Any],
        *,
        expected_prev_chain_hash: str,
        **opts: Any,
    ) -> Dict[str, Any]:
        _assert_non_empty_string(agent_id, "agent_id")
        _assert_non_empty_string(run_id, "run_id")
        _assert_non_empty_string(expected_prev_chain_hash, "expected_prev_chain_hash")
        if not isinstance(body, dict):
            raise ValueError("body is required")
        _assert_non_empty_string(body.get("type"), "body.type")
        return self._request(
            "POST",
            f"/agents/{parse.quote(agent_id, safe='')}/runs/{parse.quote(run_id, safe='')}/events",
            body=body,
            expected_prev_chain_hash=expected_prev_chain_hash,
            **opts,
        )

    def get_agent_run(self, agent_id: str, run_id: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(agent_id, "agent_id")
        _assert_non_empty_string(run_id, "run_id")
        return self._request("GET", f"/agents/{parse.quote(agent_id, safe='')}/runs/{parse.quote(run_id, safe='')}", **opts)

    def list_agent_run_events(self, agent_id: str, run_id: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(agent_id, "agent_id")
        _assert_non_empty_string(run_id, "run_id")
        return self._request("GET", f"/agents/{parse.quote(agent_id, safe='')}/runs/{parse.quote(run_id, safe='')}/events", **opts)

    def get_run_verification(self, run_id: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(run_id, "run_id")
        return self._request("GET", f"/runs/{parse.quote(run_id, safe='')}/verification", **opts)

    def get_run_settlement(self, run_id: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(run_id, "run_id")
        return self._request("GET", f"/runs/{parse.quote(run_id, safe='')}/settlement", **opts)

    def get_run_settlement_policy_replay(self, run_id: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(run_id, "run_id")
        return self._request("GET", f"/runs/{parse.quote(run_id, safe='')}/settlement/policy-replay", **opts)

    def resolve_run_settlement(self, run_id: str, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(run_id, "run_id")
        if not isinstance(body, dict):
            raise ValueError("body is required")
        return self._request("POST", f"/runs/{parse.quote(run_id, safe='')}/settlement/resolve", body=body, **opts)

    def ops_lock_tool_call_hold(self, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        if not isinstance(body, dict):
            raise ValueError("body is required")
        return self._request("POST", "/ops/tool-calls/holds/lock", body=body, **opts)

    def ops_list_tool_call_holds(self, query: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if isinstance(query, dict):
            for key in ("agreementHash", "status", "limit", "offset"):
                if query.get(key) is not None:
                    params[key] = query.get(key)
        suffix = f"?{parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/ops/tool-calls/holds{suffix}", **opts)

    def ops_get_tool_call_hold(self, hold_hash: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(hold_hash, "hold_hash")
        return self._request("GET", f"/ops/tool-calls/holds/{parse.quote(hold_hash, safe='')}", **opts)

    def ops_run_tool_call_holdback_maintenance(self, body: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        payload = {} if body is None else body
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        return self._request("POST", "/ops/maintenance/tool-call-holdback/run", body=payload, **opts)

    def tool_call_list_arbitration_cases(self, query: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        if isinstance(query, dict):
            for key in ("agreementHash", "status"):
                if query.get(key) is not None:
                    params[key] = query.get(key)
        suffix = f"?{parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/tool-calls/arbitration/cases{suffix}", **opts)

    def tool_call_get_arbitration_case(self, case_id: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(case_id, "case_id")
        return self._request("GET", f"/tool-calls/arbitration/cases/{parse.quote(case_id, safe='')}", **opts)

    def tool_call_open_arbitration(self, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        if not isinstance(body, dict):
            raise ValueError("body is required")
        return self._request("POST", "/tool-calls/arbitration/open", body=body, **opts)

    def tool_call_submit_arbitration_verdict(self, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        if not isinstance(body, dict):
            raise ValueError("body is required")
        return self._request("POST", "/tool-calls/arbitration/verdict", body=body, **opts)

    def ops_get_settlement_adjustment(self, adjustment_id: str, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(adjustment_id, "adjustment_id")
        return self._request("GET", f"/ops/settlement-adjustments/{parse.quote(adjustment_id, safe='')}", **opts)

    def open_run_dispute(self, run_id: str, body: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(run_id, "run_id")
        payload = {} if body is None else body
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        return self._request("POST", f"/runs/{parse.quote(run_id, safe='')}/dispute/open", body=payload, **opts)

    def close_run_dispute(self, run_id: str, body: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(run_id, "run_id")
        payload = {} if body is None else body
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        return self._request("POST", f"/runs/{parse.quote(run_id, safe='')}/dispute/close", body=payload, **opts)

    def submit_run_dispute_evidence(self, run_id: str, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(run_id, "run_id")
        if not isinstance(body, dict):
            raise ValueError("body is required")
        _assert_non_empty_string(body.get("evidenceRef"), "body.evidenceRef")
        return self._request("POST", f"/runs/{parse.quote(run_id, safe='')}/dispute/evidence", body=body, **opts)

    def escalate_run_dispute(self, run_id: str, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(run_id, "run_id")
        if not isinstance(body, dict):
            raise ValueError("body is required")
        _assert_non_empty_string(body.get("escalationLevel"), "body.escalationLevel")
        return self._request("POST", f"/runs/{parse.quote(run_id, safe='')}/dispute/escalate", body=body, **opts)

    def create_marketplace_rfq(self, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        if not isinstance(body, dict):
            raise ValueError("body is required")
        return self._request("POST", "/marketplace/rfqs", body=body, **opts)

    def list_marketplace_rfqs(self, query: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        params = {}
        if isinstance(query, dict):
            for key in ("status", "capability", "posterAgentId", "limit", "offset"):
                if query.get(key) is not None:
                    params[key] = query.get(key)
        suffix = f"?{parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/marketplace/rfqs{suffix}", **opts)

    def submit_marketplace_bid(self, rfq_id: str, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(rfq_id, "rfq_id")
        if not isinstance(body, dict):
            raise ValueError("body is required")
        return self._request("POST", f"/marketplace/rfqs/{parse.quote(rfq_id, safe='')}/bids", body=body, **opts)

    def list_marketplace_bids(self, rfq_id: str, query: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(rfq_id, "rfq_id")
        params = {}
        if isinstance(query, dict):
            for key in ("status", "bidderAgentId", "limit", "offset"):
                if query.get(key) is not None:
                    params[key] = query.get(key)
        suffix = f"?{parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/marketplace/rfqs/{parse.quote(rfq_id, safe='')}/bids{suffix}", **opts)

    def accept_marketplace_bid(self, rfq_id: str, body: Dict[str, Any], **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(rfq_id, "rfq_id")
        if not isinstance(body, dict):
            raise ValueError("body is required")
        _assert_non_empty_string(body.get("bidId"), "body.bidId")
        return self._request("POST", f"/marketplace/rfqs/{parse.quote(rfq_id, safe='')}/accept", body=body, **opts)

    def get_tenant_analytics(self, tenant_id: str, query: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(tenant_id, "tenant_id")
        params = {}
        if isinstance(query, dict):
            for key in ("month", "bucket", "limit"):
                if query.get(key) is not None:
                    params[key] = query.get(key)
        suffix = f"?{parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/v1/tenants/{parse.quote(tenant_id, safe='')}/analytics{suffix}", **opts)

    def get_tenant_trust_graph(self, tenant_id: str, query: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(tenant_id, "tenant_id")
        params = {}
        if isinstance(query, dict):
            for key in ("month", "minRuns", "maxEdges"):
                if query.get(key) is not None:
                    params[key] = query.get(key)
        suffix = f"?{parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/v1/tenants/{parse.quote(tenant_id, safe='')}/trust-graph{suffix}", **opts)

    def list_tenant_trust_graph_snapshots(self, tenant_id: str, query: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(tenant_id, "tenant_id")
        params = {}
        if isinstance(query, dict) and query.get("limit") is not None:
            params["limit"] = query.get("limit")
        suffix = f"?{parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/v1/tenants/{parse.quote(tenant_id, safe='')}/trust-graph/snapshots{suffix}", **opts)

    def create_tenant_trust_graph_snapshot(self, tenant_id: str, body: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(tenant_id, "tenant_id")
        payload = {} if body is None else body
        if not isinstance(payload, dict):
            raise ValueError("body must be an object")
        return self._request("POST", f"/v1/tenants/{parse.quote(tenant_id, safe='')}/trust-graph/snapshots", body=payload, **opts)

    def diff_tenant_trust_graph(self, tenant_id: str, query: Optional[Dict[str, Any]] = None, **opts: Any) -> Dict[str, Any]:
        _assert_non_empty_string(tenant_id, "tenant_id")
        params = {}
        if isinstance(query, dict):
            for key in ("baseMonth", "compareMonth", "limit", "minRuns", "maxEdges", "includeUnchanged"):
                if query.get(key) is not None:
                    params[key] = query.get(key)
        suffix = f"?{parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/v1/tenants/{parse.quote(tenant_id, safe='')}/trust-graph/diff{suffix}", **opts)

    def first_paid_rfq(
        self,
        params: Dict[str, Any],
        *,
        idempotency_prefix: Optional[str] = None,
        request_id_prefix: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict[str, Any]:
        if not isinstance(params, dict):
            raise ValueError("params must be an object")

        poster_agent = params.get("poster_agent")
        bidder_agent = params.get("bidder_agent")
        if not isinstance(poster_agent, dict):
            raise ValueError("params.poster_agent is required")
        if not isinstance(bidder_agent, dict):
            raise ValueError("params.bidder_agent is required")
        _assert_non_empty_string(poster_agent.get("publicKeyPem"), "params.poster_agent.publicKeyPem")
        _assert_non_empty_string(bidder_agent.get("publicKeyPem"), "params.bidder_agent.publicKeyPem")

        step_prefix = _normalize_prefix(
            idempotency_prefix,
            f"sdk_first_paid_rfq_{int(time.time() * 1000):x}_{random.randint(0, 0xFFFFFF):06x}",
        )
        request_prefix = _normalize_prefix(request_id_prefix, _random_request_id())

        def make_step_opts(step: str, **extra: Any) -> Dict[str, Any]:
            out = {
                "request_id": f"{request_prefix}_{step}",
                "idempotency_key": f"{step_prefix}_{step}",
                "timeout_seconds": timeout_seconds,
            }
            out.update(extra)
            return out

        poster_registration = self.register_agent(poster_agent, **make_step_opts("register_poster"))
        poster_agent_id = poster_registration.get("body", {}).get("agentIdentity", {}).get("agentId")
        _assert_non_empty_string(poster_agent_id, "poster_agent_id")

        bidder_registration = self.register_agent(bidder_agent, **make_step_opts("register_bidder"))
        bidder_agent_id = bidder_registration.get("body", {}).get("agentIdentity", {}).get("agentId")
        _assert_non_empty_string(bidder_agent_id, "bidder_agent_id")

        accepted_by_registration = None
        accepted_by_agent_id = poster_agent_id
        accepted_by_agent = params.get("accepted_by_agent")
        if accepted_by_agent is not None:
            if not isinstance(accepted_by_agent, dict):
                raise ValueError("params.accepted_by_agent must be an object")
            _assert_non_empty_string(accepted_by_agent.get("publicKeyPem"), "params.accepted_by_agent.publicKeyPem")
            accepted_by_registration = self.register_agent(accepted_by_agent, **make_step_opts("register_accepting_agent"))
            accepted_by_agent_id = accepted_by_registration.get("body", {}).get("agentIdentity", {}).get("agentId")
            _assert_non_empty_string(accepted_by_agent_id, "accepted_by_agent_id")

        payer_credit = params.get("payer_credit")
        credit_result = None
        if payer_credit is not None:
            if not isinstance(payer_credit, dict):
                raise ValueError("params.payer_credit must be an object")
            amount_cents = payer_credit.get("amountCents")
            if not isinstance(amount_cents, (int, float)) or amount_cents <= 0:
                raise ValueError("params.payer_credit.amountCents must be a positive number")
            credit_result = self.credit_agent_wallet(
                poster_agent_id,
                {
                    "amountCents": int(amount_cents),
                    "currency": payer_credit.get("currency", "USD"),
                },
                **make_step_opts("credit_poster_wallet"),
            )

        rfq_defaults = {
            "rfqId": f"rfq_{step_prefix}",
            "title": "SDK paid rfq",
            "capability": "general",
            "posterAgentId": poster_agent_id,
            "budgetCents": 1000,
            "currency": "USD",
        }
        rfq_body = {**rfq_defaults, **(params.get("rfq") if isinstance(params.get("rfq"), dict) else {})}
        rfq_body["posterAgentId"] = poster_agent_id
        create_rfq = self.create_marketplace_rfq(rfq_body, **make_step_opts("create_rfq"))
        rfq = create_rfq.get("body", {}).get("rfq", {}) if isinstance(create_rfq.get("body"), dict) else {}
        rfq_id = rfq.get("rfqId")
        _assert_non_empty_string(rfq_id, "rfq_id")

        bid_defaults = {
            "bidId": f"bid_{step_prefix}",
            "bidderAgentId": bidder_agent_id,
            "amountCents": int(rfq_body.get("budgetCents", 1000)),
            "currency": str(rfq_body.get("currency", "USD")),
            "etaSeconds": 900,
        }
        bid_body = {**bid_defaults, **(params.get("bid") if isinstance(params.get("bid"), dict) else {})}
        bid_body["bidderAgentId"] = bidder_agent_id
        submit_bid = self.submit_marketplace_bid(rfq_id, bid_body, **make_step_opts("submit_bid"))
        bid = submit_bid.get("body", {}).get("bid", {}) if isinstance(submit_bid.get("body"), dict) else {}
        bid_id = bid.get("bidId")
        _assert_non_empty_string(bid_id, "bid_id")

        settlement_config = params.get("settlement") if isinstance(params.get("settlement"), dict) else {}
        accept_defaults = {
            "bidId": bid_id,
            "acceptedByAgentId": accepted_by_agent_id,
            "settlement": {
                "payerAgentId": poster_agent_id,
                "amountCents": int(bid_body.get("amountCents")),
                "currency": str(bid_body.get("currency", rfq_body.get("currency", "USD"))),
            },
        }
        accept_body = {**accept_defaults, **(params.get("accept") if isinstance(params.get("accept"), dict) else {})}
        if not isinstance(accept_body.get("settlement"), dict):
            accept_body["settlement"] = {}
        accept_body["settlement"] = {**accept_defaults["settlement"], **accept_body["settlement"], **settlement_config}
        accept_bid = self.accept_marketplace_bid(rfq_id, accept_body, **make_step_opts("accept_bid"))
        accepted_body = accept_bid.get("body", {}) if isinstance(accept_bid.get("body"), dict) else {}
        run = accepted_body.get("run", {}) if isinstance(accepted_body.get("run"), dict) else {}
        run_id = run.get("runId")
        _assert_non_empty_string(run_id, "run_id")

        final_event = None
        final_run = run
        final_settlement = accepted_body.get("settlement")
        if params.get("auto_complete", True):
            prev_chain_hash = run.get("lastChainHash")
            _assert_non_empty_string(prev_chain_hash, "run.lastChainHash")
            completed_payload = dict(params.get("completed_payload") or {})
            completed_payload.setdefault("outputRef", f"evidence://{run_id}/result.json")
            if isinstance(params.get("completed_metrics"), dict):
                completed_payload["metrics"] = params.get("completed_metrics")
            elif "metrics" not in completed_payload:
                completed_payload["metrics"] = {"settlementReleaseRatePct": 100}
            completed = self.append_agent_run_event(
                bidder_agent_id,
                run_id,
                {"type": "RUN_COMPLETED", "actor": {"type": "agent", "id": bidder_agent_id}, "payload": completed_payload},
                expected_prev_chain_hash=prev_chain_hash,
                **make_step_opts("run_completed"),
            )
            completed_body = completed.get("body", {}) if isinstance(completed.get("body"), dict) else {}
            final_event = completed_body.get("event")
            final_run = completed_body.get("run", final_run)
            final_settlement = completed_body.get("settlement", final_settlement)

        verification = self.get_run_verification(run_id, **make_step_opts("verification", idempotency_key=None))
        settlement = self.get_run_settlement(run_id, **make_step_opts("settlement", idempotency_key=None))

        return {
            "ids": {
                "poster_agent_id": poster_agent_id,
                "bidder_agent_id": bidder_agent_id,
                "accepted_by_agent_id": accepted_by_agent_id,
                "rfq_id": rfq_id,
                "bid_id": bid_id,
                "run_id": run_id,
            },
            "poster_registration": poster_registration,
            "bidder_registration": bidder_registration,
            "accepted_by_registration": accepted_by_registration,
            "payer_credit": credit_result,
            "create_rfq": create_rfq,
            "submit_bid": submit_bid,
            "accept_bid": accept_bid,
            "final_event": final_event,
            "final_run": final_run,
            "final_settlement": final_settlement,
            "verification": verification,
            "settlement": settlement,
        }

    def first_verified_run(
        self,
        params: Dict[str, Any],
        *,
        idempotency_prefix: Optional[str] = None,
        request_id_prefix: Optional[str] = None,
        timeout_seconds: Optional[float] = None,
    ) -> Dict[str, Any]:
        if not isinstance(params, dict):
            raise ValueError("params must be an object")
        payee_agent = params.get("payee_agent")
        if not isinstance(payee_agent, dict):
            raise ValueError("params.payee_agent is required")
        _assert_non_empty_string(payee_agent.get("publicKeyPem"), "params.payee_agent.publicKeyPem")

        step_prefix = _normalize_prefix(
            idempotency_prefix,
            f"sdk_first_verified_run_{int(time.time() * 1000):x}_{random.randint(0, 0xFFFFFF):06x}",
        )
        request_prefix = _normalize_prefix(request_id_prefix, _random_request_id())

        def make_step_opts(step: str, **extra: Any) -> Dict[str, Any]:
            out = {
                "request_id": f"{request_prefix}_{step}",
                "idempotency_key": f"{step_prefix}_{step}",
                "timeout_seconds": timeout_seconds,
            }
            out.update(extra)
            return out

        payee_registration = self.register_agent(payee_agent, **make_step_opts("register_payee"))
        payee_agent_id = payee_registration.get("body", {}).get("agentIdentity", {}).get("agentId")
        _assert_non_empty_string(payee_agent_id, "payee_agent_id")

        payer_registration = None
        payer_credit = None
        payer_agent_id = None
        payer_agent = params.get("payer_agent")
        if payer_agent is not None:
            if not isinstance(payer_agent, dict):
                raise ValueError("params.payer_agent must be an object")
            _assert_non_empty_string(payer_agent.get("publicKeyPem"), "params.payer_agent.publicKeyPem")
            payer_registration = self.register_agent(payer_agent, **make_step_opts("register_payer"))
            payer_agent_id = payer_registration.get("body", {}).get("agentIdentity", {}).get("agentId")
            _assert_non_empty_string(payer_agent_id, "payer_agent_id")

        settlement = params.get("settlement") if isinstance(params.get("settlement"), dict) else None
        settlement_amount_cents = settlement.get("amountCents") if settlement else None
        settlement_currency = settlement.get("currency", "USD") if settlement else "USD"
        settlement_payer_agent_id = (
            settlement.get("payerAgentId")
            if settlement and isinstance(settlement.get("payerAgentId"), str)
            else payer_agent_id
        )
        if settlement_amount_cents is not None and settlement_payer_agent_id is None:
            raise ValueError("params.payer_agent or params.settlement.payerAgentId is required when settlement is requested")

        payer_credit_input = params.get("payer_credit")
        if payer_credit_input is not None:
            if not isinstance(payer_credit_input, dict):
                raise ValueError("params.payer_credit must be an object")
            payer_credit_amount = payer_credit_input.get("amountCents")
            if not isinstance(payer_credit_amount, (int, float)) or payer_credit_amount <= 0:
                raise ValueError("params.payer_credit.amountCents must be a positive number")
            if not payer_agent_id:
                raise ValueError("params.payer_agent is required when params.payer_credit is provided")
            payer_credit = self.credit_agent_wallet(
                payer_agent_id,
                {
                    "amountCents": int(payer_credit_amount),
                    "currency": payer_credit_input.get("currency", settlement_currency),
                },
                **make_step_opts("credit_payer_wallet"),
            )

        run_body = dict(params.get("run") or {})
        if settlement_amount_cents is not None:
            if not isinstance(settlement_amount_cents, (int, float)) or settlement_amount_cents <= 0:
                raise ValueError("params.settlement.amountCents must be a positive number")
            run_body["settlement"] = {
                "payerAgentId": settlement_payer_agent_id,
                "amountCents": int(settlement_amount_cents),
                "currency": settlement_currency,
            }

        run_created = self.create_agent_run(payee_agent_id, run_body, **make_step_opts("create_run"))
        run_id = run_created.get("body", {}).get("run", {}).get("runId")
        _assert_non_empty_string(run_id, "run_id")
        prev_chain_hash = run_created.get("body", {}).get("run", {}).get("lastChainHash")
        _assert_non_empty_string(prev_chain_hash, "run_created.body.run.lastChainHash")

        actor = params.get("actor") or {"type": "agent", "id": payee_agent_id}
        started_payload = params.get("started_payload") or {"startedBy": "sdk.first_verified_run"}
        run_started = self.append_agent_run_event(
            payee_agent_id,
            run_id,
            {"type": "RUN_STARTED", "actor": actor, "payload": started_payload},
            expected_prev_chain_hash=prev_chain_hash,
            **make_step_opts("run_started"),
        )
        prev_chain_hash = run_started.get("body", {}).get("run", {}).get("lastChainHash")
        _assert_non_empty_string(prev_chain_hash, "run_started.body.run.lastChainHash")

        evidence_ref = params.get("evidence_ref") if isinstance(params.get("evidence_ref"), str) and params.get("evidence_ref").strip() else f"evidence://{run_id}/output.json"
        evidence_payload = params.get("evidence_payload") if isinstance(params.get("evidence_payload"), dict) else {"evidenceRef": evidence_ref}
        run_evidence_added = self.append_agent_run_event(
            payee_agent_id,
            run_id,
            {"type": "EVIDENCE_ADDED", "actor": actor, "payload": evidence_payload},
            expected_prev_chain_hash=prev_chain_hash,
            **make_step_opts("evidence_added"),
        )
        prev_chain_hash = run_evidence_added.get("body", {}).get("run", {}).get("lastChainHash")
        _assert_non_empty_string(prev_chain_hash, "run_evidence_added.body.run.lastChainHash")

        completed_payload = dict(params.get("completed_payload") or {})
        output_ref = params.get("output_ref") if isinstance(params.get("output_ref"), str) and params.get("output_ref").strip() else evidence_ref
        completed_payload["outputRef"] = output_ref
        if isinstance(params.get("completed_metrics"), dict):
            completed_payload["metrics"] = params.get("completed_metrics")
        run_completed = self.append_agent_run_event(
            payee_agent_id,
            run_id,
            {"type": "RUN_COMPLETED", "actor": actor, "payload": completed_payload},
            expected_prev_chain_hash=prev_chain_hash,
            **make_step_opts("run_completed"),
        )

        run = self.get_agent_run(payee_agent_id, run_id, **make_step_opts("get_run"))
        verification = self.get_run_verification(run_id, **make_step_opts("get_verification"))
        settlement_out = None
        if run_body.get("settlement") or run_created.get("body", {}).get("settlement") or run_completed.get("body", {}).get("settlement"):
            settlement_out = self.get_run_settlement(run_id, **make_step_opts("get_settlement"))

        return {
            "ids": {"run_id": run_id, "payee_agent_id": payee_agent_id, "payer_agent_id": payer_agent_id},
            "payee_registration": payee_registration,
            "payer_registration": payer_registration,
            "payer_credit": payer_credit,
            "run_created": run_created,
            "run_started": run_started,
            "run_evidence_added": run_evidence_added,
            "run_completed": run_completed,
            "run": run,
            "verification": verification,
            "settlement": settlement_out,
        }
