#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import sys
from datetime import datetime, timezone

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "packages" / "api-sdk-python"))

from nooterra_api_sdk import NooterraClient  # noqa: E402


def month_key_utc_now() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


def previous_month_key(month_key: str) -> str:
    raw = str(month_key or "").strip()
    try:
        year = int(raw[0:4])
        month = int(raw[5:7])
        if raw[4] != "-" or month < 1 or month > 12:
            raise ValueError("invalid month")
    except Exception:
        return month_key_utc_now()
    month -= 1
    if month < 1:
        month = 12
        year -= 1
    return f"{year:04d}-{month:02d}"


def main() -> int:
    base_url = os.environ.get("NOOTERRA_BASE_URL", "http://127.0.0.1:8787")
    tenant_id = os.environ.get("NOOTERRA_TENANT_ID", "tenant_default")
    api_key = os.environ.get("NOOTERRA_API_KEY")
    x_api_key = os.environ.get("NOOTERRA_X_API_KEY")
    month = os.environ.get("NOOTERRA_MONTH", month_key_utc_now())
    base_month = os.environ.get("NOOTERRA_BASE_MONTH", previous_month_key(month))

    if not x_api_key:
        print("NOOTERRA_X_API_KEY is not set; calls will fail unless Magic Link auth is disabled.", file=sys.stderr)

    client = NooterraClient(
        base_url=base_url,
        tenant_id=tenant_id,
        api_key=api_key,
        x_api_key=x_api_key,
    )

    analytics_res = client.get_tenant_analytics(
        tenant_id,
        {"month": month, "bucket": "day", "limit": 20},
    )
    graph_res = client.get_tenant_trust_graph(
        tenant_id,
        {"month": month, "minRuns": 1, "maxEdges": 200},
    )
    snapshots_res = client.list_tenant_trust_graph_snapshots(tenant_id, {"limit": 10})
    snapshot_create_res = client.create_tenant_trust_graph_snapshot(
        tenant_id,
        {"month": month, "minRuns": 1, "maxEdges": 200},
    )
    diff_res = client.diff_tenant_trust_graph(
        tenant_id,
        {
            "baseMonth": base_month,
            "compareMonth": month,
            "limit": 20,
            "minRuns": 1,
            "maxEdges": 200,
        },
    )

    report = analytics_res.get("body", {}).get("report", {})
    graph = graph_res.get("body", {}).get("graph", {})
    snapshot = snapshot_create_res.get("body", {}).get("snapshot", {})
    diff = diff_res.get("body", {}).get("diff", {})
    totals = report.get("totals", {}) if isinstance(report, dict) else {}
    summary = {
        "tenantId": tenant_id,
        "month": month,
        "baseMonth": base_month,
        "analytics": {
            "runs": totals.get("runs"),
            "greenRatePct": totals.get("greenRatePct"),
            "approvalRatePct": totals.get("approvalRatePct"),
            "holdRatePct": totals.get("holdRatePct"),
        },
        "trustGraph": {
            "nodes": len(graph.get("nodes", [])) if isinstance(graph.get("nodes"), list) else None,
            "edges": len(graph.get("edges", [])) if isinstance(graph.get("edges"), list) else None,
            "runs": graph.get("summary", {}).get("runs") if isinstance(graph.get("summary"), dict) else None,
        },
        "snapshots": {
            "listed": snapshots_res.get("body", {}).get("count"),
            "createdMonth": snapshot.get("month"),
            "createdAt": snapshot.get("generatedAt"),
        },
        "diff": {
            "nodeChanges": diff.get("summary", {}).get("nodeChanges") if isinstance(diff.get("summary"), dict) else None,
            "edgeChanges": diff.get("summary", {}).get("edgeChanges") if isinstance(diff.get("summary"), dict) else None,
            "added": diff.get("summary", {}).get("added") if isinstance(diff.get("summary"), dict) else None,
            "removed": diff.get("summary", {}).get("removed") if isinstance(diff.get("summary"), dict) else None,
            "changed": diff.get("summary", {}).get("changed") if isinstance(diff.get("summary"), dict) else None,
        },
    }

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
