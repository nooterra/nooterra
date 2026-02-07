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
        user_agent: Optional[str] = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self.base_url = _assert_non_empty_string(base_url, "base_url").rstrip("/")
        self.tenant_id = _assert_non_empty_string(tenant_id, "tenant_id")
        self.protocol = protocol
        self.api_key = api_key
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
