# Federation Two-Coordinator Demo (A->B)

This demo starts two local coordinators and verifies a federated work-order route:

1. Coordinator A routes a work order using an agent card with `executionCoordinatorDid` set to Coordinator B.
2. Coordinator A forwards the invoke envelope to Coordinator B.
3. Coordinator B accepts and queues the incoming invoke (`/v1/federation/invoke`).

Run from repo root:

```bash
node examples/federation-demo/run-two-node.mjs
```

Optional JSON artifact output:

```bash
node examples/federation-demo/run-two-node.mjs --json-out /tmp/federation-demo-result.json
```

The script exits non-zero if federation routing/forwarding does not succeed fail-closed.
