# Nooterra Documentation Index

This root docs index is for GitBook sync setups using project directory `docs`.

Launch v1 is the host-first Action Wallet for `buy` and `cancel/recover` through `Claude MCP` and `OpenClaw`.
If a doc implies a first-party assistant shell, booking, BYO payment rails, or unsupported hosts, treat that as Phase 1.5+ unless the doc is linked below.

For curated public docs, start here:

- [Action Wallet v1 PRD](./PRD.md)
- [Action Wallet v1 freeze](./spec/ACTION_WALLET_V1_FREEZE.md)
- [Homepage copy draft](./marketing/action-wallet-homepage-copy-2026-03-09.md)
- [Product surfaces + user stories](./plans/2026-03-09-action-wallet-v1-surfaces-and-user-stories.md)
- [First 10 kickoff tickets](./plans/2026-03-09-action-wallet-v1-first-10-ticket-packet.md)
- [Host quickstart](./QUICKSTART_MCP_HOSTS.md)
- [Claude Desktop quickstart](./integrations/claude-desktop/PUBLIC_QUICKSTART.md)
- [OpenClaw quickstart](./integrations/openclaw/PUBLIC_QUICKSTART.md)
- [Nooterra Docs home](./gitbook/README.md)
- [Quickstart: Agent Bootstrap](./QUICKSTART_AGENT_BOOTSTRAP.md)
- [Quickstart: Profiles CLI](./QUICKSTART_PROFILES.md)
- [Core Primitives](./gitbook/core-primitives.md)
- [API Reference](./gitbook/api-reference.md)
- [Conformance](./gitbook/conformance.md)
- [Closepacks](./gitbook/closepacks.md)
- [Guides](./gitbook/guides.md)
- [Naming conventions](./NAMING.md)
- [Brand guidelines](./BRAND_GUIDELINES.md)
- [Security Model](./gitbook/security-model.md)
- [FAQ](./gitbook/faq.md)

## Fastest onboarding path

1. Run `nooterra setup` (or `./bin/nooterra.js setup`), choose `quick`, and pick `claude` or `openclaw`.
2. Complete sign-in and let setup write the hosted approval configuration for that host.
3. In the host, ask Nooterra to create an action intent and request approval.
4. Open the hosted approval URL, approve or deny, then return to the host.
5. Fetch the execution grant, finalize the action, and open the receipt or dispute flow.

```bash
npm run mcp:probe
```

Reference docs:

- `docs/QUICKSTART_MCP_HOSTS.md`
- `docs/integrations/claude-desktop/PUBLIC_QUICKSTART.md`
- `docs/integrations/openclaw/PUBLIC_QUICKSTART.md`
- `docs/spec/ACTION_WALLET_V1_FREEZE.md`
