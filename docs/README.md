# Nooterra Documentation Index

This root docs index is for GitBook sync setups using project directory `docs`.

Launch v1 is the host-first Action Wallet for `buy` and `cancel/recover` through `Claude MCP` and `OpenClaw`.
If a doc implies a first-party assistant shell, booking, BYO payment rails, or unsupported hosts, treat that as Phase 1.5+ unless the doc is linked below.
If you are working from Codex, use the same Action Wallet runtime through the API or CLI path; Codex is an engineering shell on the same contract, not a separate certified launch channel.

For curated public docs, start here:

- [Action Wallet v1 PRD](./PRD.md)
- [Action Wallet v1 freeze](./spec/ACTION_WALLET_V1_FREEZE.md)
- [Homepage copy draft](./marketing/action-wallet-homepage-copy-2026-03-09.md)
- [Product surfaces + user stories](./plans/2026-03-09-action-wallet-v1-surfaces-and-user-stories.md)
- [First 10 kickoff tickets](./plans/2026-03-09-action-wallet-v1-first-10-ticket-packet.md)
- [Host quickstart](./QUICKSTART_MCP_HOSTS.md)
- [Claude Desktop quickstart](./integrations/claude-desktop/PUBLIC_QUICKSTART.md)
- [OpenClaw quickstart](./integrations/openclaw/PUBLIC_QUICKSTART.md)
- [Codex engineering quickstart](./integrations/codex/ENGINEERING_QUICKSTART.md)
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

Use the same Action Wallet activation loop everywhere:

1. **Runtime bootstrap**
   Run `nooterra setup`, choose `quick`, and connect the runtime for `claude` or `openclaw`.
   If you are working from Codex, reuse the same runtime values through the API or CLI path.
2. **Request first approval**
   From the host or shell, create an action intent and request a hosted approval.
3. **Open receipt**
   After approval and host-side execution, submit evidence if needed, finalize, and open the hosted receipt.
4. **Open dispute**
   If something is wrong, open the dispute from the same receipt or run context.

If you are testing from Codex instead of a launch host, reuse the same runtime values through the API or CLI examples in the developers page and docs. The approval, receipt, and dispute surfaces stay identical.

```bash
npm run mcp:probe
```

Reference docs:

- `docs/QUICKSTART_MCP_HOSTS.md`
- `docs/integrations/claude-desktop/PUBLIC_QUICKSTART.md`
- `docs/integrations/openclaw/PUBLIC_QUICKSTART.md`
- `docs/spec/ACTION_WALLET_V1_FREEZE.md`
