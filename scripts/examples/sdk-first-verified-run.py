#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import random
import sys
import time

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "packages" / "api-sdk-python"))

from nooterra_api_sdk import NooterraClient  # noqa: E402


def _unique_suffix() -> str:
    return f"{int(time.time() * 1000):x}_{random.randint(0, 0xFFFFFF):06x}"


def _fixture_keys() -> tuple[str, str]:
    fixture_path = REPO_ROOT / "test" / "fixtures" / "keys" / "fixture_keypairs.json"
    with fixture_path.open("r", encoding="utf-8") as fp:
        raw = json.load(fp)
    payee = str(raw["serverA"]["publicKeyPem"])
    payer = str(raw["serverB"]["publicKeyPem"])
    return payee, payer


def main() -> int:
    base_url = os.environ.get("NOOTERRA_BASE_URL", "http://127.0.0.1:3000")
    tenant_id = os.environ.get("NOOTERRA_TENANT_ID", "tenant_default")
    api_key = os.environ.get("NOOTERRA_API_KEY")

    if not api_key:
        print("NOOTERRA_API_KEY is not set; calls will fail unless API auth is disabled.", file=sys.stderr)

    payee_public_key_pem, payer_public_key_pem = _fixture_keys()
    suffix = _unique_suffix()
    run_id = f"run_sdk_py_{suffix}"

    client = NooterraClient(
        base_url=base_url,
        tenant_id=tenant_id,
        api_key=api_key,
    )

    result = client.first_verified_run(
        {
            "payee_agent": {
                "agentId": f"agt_py_payee_{suffix}",
                "displayName": "Python SDK Demo Payee",
                "owner": {"ownerType": "service", "ownerId": "svc_sdk_py_demo"},
                "capabilities": ["translate", "summarize"],
                "publicKeyPem": payee_public_key_pem,
            },
            "payer_agent": {
                "agentId": f"agt_py_payer_{suffix}",
                "displayName": "Python SDK Demo Payer",
                "owner": {"ownerType": "service", "ownerId": "svc_sdk_py_demo"},
                "capabilities": ["dispatch"],
                "publicKeyPem": payer_public_key_pem,
            },
            "payer_credit": {"amountCents": 5000, "currency": "USD"},
            "settlement": {"amountCents": 1250, "currency": "USD"},
            "run": {
                "runId": run_id,
                "taskType": "translation",
                "inputRef": f"urn:sdk:python:first-run:{suffix}",
            },
            "completed_metrics": {"latencyMs": 420},
        }
    )

    verification_body = result.get("verification", {}).get("body", {})
    verification_status = None
    if isinstance(verification_body, dict):
        verification = verification_body.get("verification", {})
        if isinstance(verification, dict):
            verification_status = verification.get("verificationStatus")
        if verification_status is None:
            verification_status = verification_body.get("verificationStatus")

    summary = {
        "runId": result.get("ids", {}).get("run_id"),
        "payeeAgentId": result.get("ids", {}).get("payee_agent_id"),
        "payerAgentId": result.get("ids", {}).get("payer_agent_id"),
        "runStatus": result.get("run_completed", {}).get("body", {}).get("run", {}).get("status"),
        "verificationStatus": verification_status,
        "settlementStatus": result.get("settlement", {}).get("body", {}).get("settlement", {}).get("status")
        if result.get("settlement")
        else None,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
