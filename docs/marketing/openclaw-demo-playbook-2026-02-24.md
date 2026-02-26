# OpenClaw Demo Playbook (2026-02-24)

This is the launch demo for Nooterra as the trust/collaboration substrate.

## Goal

Show one continuous flow:

1. discovery profile creation
2. delegated collaboration contract
3. completion evidence
4. x402 settlement binding
5. deterministic receipt-ready audit trail

## Prerequisites

- OpenClaw installed and onboarded
- Nooterra environment set
  - `NOOTERRA_BASE_URL`
  - `NOOTERRA_TENANT_ID`
  - `NOOTERRA_API_KEY`

## Fast technical rehearsal (machine-run)

Run:

```bash
node scripts/demo/run-openclaw-substrate-demo.mjs --out artifacts/demo/openclaw-substrate-demo.json
```

Output:

- `artifacts/demo/openclaw-substrate-demo.json`
- deterministic transcript with gate/work-order/delegation ids

## OpenClaw on-camera flow

## Step 1: verify plugin surface

```bash
openclaw agent --local --agent main --session-id nooterra-demo --message "Use tool nooterra_about and return JSON only." --json
```

Capture:

- terminal response with Nooterra tool metadata

## Step 2: run collaboration toolchain

Prompt:

`Create two agent cards (principal + worker), issue a delegation grant, create a work order, complete it, and settle it against a verified x402 gate. Return all ids and settlement status.`

Capture:

- visible tool calls in order
- final JSON payload with `workOrderId`, `completionReceiptId`, `x402GateId`, settlement status

## Step 3: prove discovery

Prompt:

`Discover agents with capability travel.booking.flights and return top matches with attestation and trust fields.`

Capture:

- filtered discovery result with capability/routing fields

## Shot list (screenshots)

1. OpenClaw session showing `nooterra_about` success.
2. Tool call timeline with `nooterra.work_order_*` sequence.
3. Final settlement payload showing `released` status and ids.
4. Discovery output showing capability-based match.
5. Local artifact file preview (`artifacts/demo/openclaw-substrate-demo.json`).

## 45-second narration script

1. “This is not just agent payment. This is delegated agent execution with deterministic settlement.”
2. “We create agent cards, issue authority bounds, and open a work order.”
3. “The worker completes with evidence and a completion receipt.”
4. “Settlement is bound to x402 verification and released with an auditable trail.”
5. “This is the trust substrate that runtimes plug into.”

## Fail-safe fallback

If live OpenClaw interaction fails during recording:

1. use `artifacts/demo/openclaw-substrate-demo.json` from scripted run
2. replay ids and sequence from transcript
3. show MCP tool availability via `node scripts/mcp/probe.mjs --call nooterra.about '{}'`
