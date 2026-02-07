#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "packages" / "api-sdk-python"))

from settld_api_sdk import SettldClient  # noqa: E402


def main() -> int:
    client = SettldClient(base_url="http://127.0.0.1:0", tenant_id="tenant_default")
    required = (
        "first_verified_run",
        "get_tenant_analytics",
        "get_tenant_trust_graph",
        "list_tenant_trust_graph_snapshots",
        "create_tenant_trust_graph_snapshot",
        "diff_tenant_trust_graph",
    )
    if any(not hasattr(client, name) for name in required):
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
