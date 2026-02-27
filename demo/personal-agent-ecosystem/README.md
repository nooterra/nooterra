# Demo: Personal Agent Ecosystem (S8)

This demo points to the runnable S8 workflow under `examples/personal-manager` and focuses on fail-closed high-risk controls.

Run:

```bash
node examples/personal-manager/run-simulation.mjs
```

Inspect artifact:

- `examples/personal-manager/output/latest/simulation-run.json`

What to show:

1. `previewRun.summary.blockedActions` is `1` because high-risk transfer lacks approval.
2. `approvedRun.summary.blockedActions` is `0` once explicit approval is provided.
3. `approvedRun.actionResults[*].actionSha256` and approval decision bindings are deterministic across reruns.

