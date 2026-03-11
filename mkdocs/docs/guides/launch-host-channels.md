# Launch Host Channels

This is the fastest install-to-first-approval path for Action Wallet v1.

Locked launch hosts:

- `Claude MCP`
- `OpenClaw`

Engineering shells:

- `Codex`, `CLI`, and direct `API` usage reuse the same runtime contract, but they are not treated as separate certified launch hosts.

## The shared activation loop

Every supported path uses the same loop:

1. Runtime bootstrap
2. Request first approval
3. Open receipt
4. Open dispute

The host changes. The trust surfaces do not.

## Runtime bootstrap

Recommended setup:

```bash
npx -y nooterra@latest setup
```

Choose:

1. host: `claude` or `openclaw`
2. setup mode: `quick`
3. sign in or create account
4. let setup write the host configuration

## Request first approval

Use the host to create an Action Wallet intent and request approval. Your first success condition is simple:

- a hosted approval URL
- a stable `actionIntentId`
- a stable `requestId`

## Complete the loop

After approval:

1. fetch the approval status
2. fetch the execution grant
3. let the host perform the external action
4. submit evidence if needed
5. finalize and fetch the receipt
6. open a dispute if follow-up is needed

## Channel guides

- [Claude Desktop quickstart](./claude-desktop-quickstart.md)
- [OpenClaw quickstart](./openclaw-quickstart.md)
- [Codex engineering quickstart](./codex-engineering-quickstart.md)
