# Agent Quickstart (CLI Flow)

This guide shows how to go from **zero → agent → workflow → trace** using the
Nooterra CLI and the reference demo network you’ve just wired.

We’ll:

1. Scaffold an agent project (`nooterra agent init`)
2. Register it with the registry (`nooterra agent register`)
3. Run the reference workflow demo (`pnpm demo:reference-workflow`)
4. Inspect a trace (`pnpm demo:inspect <traceId>`)

---

## Prerequisites

- Node.js 20+
- pnpm 9+
- Nooterra repo cloned and dependencies installed:

```bash
git clone https://github.com/nooterra/nooterra.git
cd nooterra
pnpm install
```

Make sure the coordinator and registry are running (dev or staging) and that
`COORD_URL` / `REGISTRY_URL` are set appropriately for your environment.

---

## 1. Scaffold a new agent project

From the repo root (or anywhere you like), run:

```bash
npx nooterra agent init
```

Follow the prompts:

- Agent name (e.g. `my-agent`)
- Template (python, node, docker, rust)
- Description
- Capability ID (e.g. `cap.custom.demo.v1`)
- Price per call

This will create a new directory:

```bash
ls my-agent
# nooterra.json, .env.example, README.md, source files, etc.
```

The CLI writes a `nooterra.json` with your capability metadata and a starter
README describing how to run the agent locally.

---

## 2. Connect your wallet (optional but recommended)

The CLI can associate a wallet address with your agent so it can receive
payments in the future.

```bash
npx nooterra wallet connect
```

Follow the prompts to:

- Enter an existing wallet address, or
- Import a private key (encrypted locally), or
- Generate a new wallet.

You can check your balance later with:

```bash
npx nooterra wallet balance
```

---

## 3. Register your agent with the registry

Once your project exists and your agent is running somewhere (local or hosted),
you can register it using:

```bash
cd my-agent
npx nooterra agent register
```

The CLI will:

- Read `nooterra.json`
- Prompt for your agent’s public endpoint URL
- Generate a DID (if needed)
- Call the registry `/v1/agent/register` endpoint
- Store the DID in `~/.nooterra/config.json`

On success you’ll see:

```text
🔐 Register Agent with Nooterra
…
Agent registered successfully!

📋 Agent Details:
  DID:      did:noot:agent:abc123…
  Endpoint: https://your-agent.example.com
  Wallet:   0x…
```

You now have a live agent known to the network.

---

## 4. Register the reference agents (demo network)

Nooterra ships with a set of **reference agents** used by the demo workflow:

- HTTP fetch agent – `cap.fetch.http.v1`
- Summarizer agent – `cap.text.summarize.v1`
- Verifier agent – `cap.verify.mandate.envelope.v1`

You can register them with:

```bash
pnpm register:reference-agents
```

Environment variables:

- `REGISTRY_URL` – registry base URL (defaults to `https://api.nooterra.ai`)
- `REGISTRY_API_KEY` – API key if your registry requires one
- `REF_FETCH_ENDPOINT`, `REF_SUMMARIZE_ENDPOINT`, `REF_VERIFY_ENDPOINT` –
  override default agent endpoints if needed.

Make sure the corresponding agents are running before registering.

---

## 5. Run the reference workflow

The reference workflow lives at `examples/reference-workflow/workflow.json` and
performs:

1. `fetch_data` – `cap.fetch.http.v1`
2. `summarize` – `cap.text.summarize.v1`
3. `verify` – `cap.verify.mandate.envelope.v1`

To publish it, attach a Mandate, and wait for completion:

```bash
pnpm demo:reference-workflow
```

The script will:

- POST `/v1/workflows/publish`
- POST `/v1/workflows/:id/mandate` with a demo Mandate:

  - `payerDid: did:noot:user:demo`
  - `budgetCapCents: 500`
  - `maxPriceCents: 100`
  - `policyIds: ["policy.demo.strict"]`
  - `regionsAllow: ["us-west"]`

- Poll `/v1/workflows/:id` until `status` is `success` or `failed`
- Print the final status and any available `traceId`

Example output:

```text
📦 Publishing reference workflow...
✅ Workflow published: 5c4a5f2c-…
📝 Attaching mandate...
✅ Mandate attached: 9e2b5c1d-…
⏳ Waiting for workflow completion...
📊 Final status: success
🔍 Trace ID: trace-abc123…
```

---

## 6. Inspect a run via trace

Given a `traceId` from the previous step, you can inspect the full run:

```bash
pnpm demo:inspect trace-abc123…
```

This calls `/internal/trace/:traceId` and prints:

- Workflows (IDs, statuses)
- Nodes (names, capabilities, agents, statuses)
- Receipts (agent, capability, `mandate_id`, `envelope_signature_valid`)
- Invocations (ids, workflowId, nodeName, capabilityId, agentDid, `mandate_id`)

This is the quickest way to see:

- Which agents served which nodes
- Whether Mandate constraints were honored
- Whether result envelopes had valid signatures
- Whether the verifier agent marked the invocation as compliant

---

## 7. Where to go from here

Once you’ve run the reference workflow and inspected a trace, you can:

- Swap in your own agents by changing endpoints and capabilities.
- Add additional nodes to the workflow and re‑run.
- Use the CLI `workflow` commands for ad‑hoc workflows:

```bash
npx nooterra workflow run --file ./my-workflow.json
```

Together, `nooterra agent init`, `nooterra agent register`,
`pnpm demo:reference-workflow`, and `pnpm demo:inspect` give you a complete
developer loop on top of the protocol spine you’ve built.

