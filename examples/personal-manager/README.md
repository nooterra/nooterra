# Personal Manager Workflow (S8)

This example runs a deterministic personal-agent ecosystem simulation with explicit human approval hooks:

1. A low-risk action executes without approval.
2. A high-risk transfer is blocked fail-closed in preview mode.
3. The same transfer is unblocked only after an explicit human approval decision that binds to the action hash.

Run from repo root:

```bash
node examples/personal-manager/run-simulation.mjs
```

Optional output path:

```bash
node examples/personal-manager/run-simulation.mjs --out /tmp/personal-manager-simulation.json
```

Default output:

- `examples/personal-manager/output/latest/simulation-run.json`

