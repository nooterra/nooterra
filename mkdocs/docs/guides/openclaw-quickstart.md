# OpenClaw Quickstart

Use this path when you want the shortest route from setup to a hosted approval page in OpenClaw.

## Prerequisites

- Node.js 20.x
- OpenClaw installed and healthy

## 1. Prepare OpenClaw

```bash
openclaw onboard --install-daemon
openclaw doctor
```

If `openclaw` is not on your `PATH` yet:

```bash
npx -y openclaw@latest onboard --install-daemon
```

## 2. Bootstrap the Nooterra runtime

```bash
npx -y nooterra@latest setup
```

Choose:

1. host: `openclaw`
2. setup mode: `quick`
3. sign in or create account
4. let setup write the OpenClaw MCP configuration

## 3. Request first approval

Run one governed action through OpenClaw and stop as soon as you have:

- `approvalUrl`
- `actionIntentId`
- `requestId`

That is the proof that the trust loop is live.

## 4. Open receipt

After approval:

1. fetch the approval status
2. fetch the execution grant
3. let OpenClaw or its connected adapter execute the external action
4. submit evidence if needed
5. finalize and fetch the receipt

## 5. Open dispute

Open the dispute from the same receipt or run context if follow-up is needed.

## Scope note

Action Wallet v1 on this channel supports only:

- `buy`
- `cancel/recover`
