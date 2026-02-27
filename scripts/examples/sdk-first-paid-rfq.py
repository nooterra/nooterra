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
    poster = str(raw["serverA"]["publicKeyPem"])
    bidder = str(raw["serverB"]["publicKeyPem"])
    return poster, bidder


def main() -> int:
    base_url = os.environ.get("NOOTERRA_BASE_URL", "http://127.0.0.1:3000")
    tenant_id = os.environ.get("NOOTERRA_TENANT_ID", "tenant_default")
    api_key = os.environ.get("NOOTERRA_API_KEY")
    if not api_key:
        print("NOOTERRA_API_KEY is not set; calls will fail unless API auth is disabled.", file=sys.stderr)

    poster_key, bidder_key = _fixture_keys()
    suffix = _unique_suffix()

    client = NooterraClient(
        base_url=base_url,
        tenant_id=tenant_id,
        api_key=api_key,
    )

    result = client.first_paid_rfq(
        {
            "poster_agent": {
                "agentId": f"agt_py_poster_{suffix}",
                "displayName": "Python SDK Poster",
                "owner": {"ownerType": "service", "ownerId": "svc_sdk_py_paid_rfq"},
                "capabilities": ["request"],
                "publicKeyPem": poster_key,
            },
            "bidder_agent": {
                "agentId": f"agt_py_bidder_{suffix}",
                "displayName": "Python SDK Bidder",
                "owner": {"ownerType": "service", "ownerId": "svc_sdk_py_paid_rfq"},
                "capabilities": ["translate", "summarize"],
                "publicKeyPem": bidder_key,
            },
            "payer_credit": {"amountCents": 2500, "currency": "USD"},
            "rfq": {
                "rfqId": f"rfq_py_{suffix}",
                "title": "Translate launch note",
                "capability": "translate",
                "budgetCents": 1200,
                "currency": "USD",
            },
            "bid": {
                "bidId": f"bid_py_{suffix}",
                "amountCents": 1100,
                "currency": "USD",
                "etaSeconds": 600,
            },
            "completed_metrics": {"settlementReleaseRatePct": 100, "latencyMs": 375},
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

    settlement_body = result.get("settlement", {}).get("body", {})
    settlement_status = settlement_body.get("settlement", {}).get("status") if isinstance(settlement_body, dict) else None

    summary = {
        "rfqId": result.get("ids", {}).get("rfq_id"),
        "runId": result.get("ids", {}).get("run_id"),
        "posterAgentId": result.get("ids", {}).get("poster_agent_id"),
        "bidderAgentId": result.get("ids", {}).get("bidder_agent_id"),
        "verificationStatus": verification_status,
        "settlementStatus": settlement_status,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
