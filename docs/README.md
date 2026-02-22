# Settld Documentation Index

This root docs index is for GitBook sync setups using project directory `docs`.

For curated public docs, start here:

- [Settld Docs home](./gitbook/README.md)
- [Quickstart](./gitbook/quickstart.md)
- [Quickstart: Profiles CLI](./QUICKSTART_PROFILES.md)
- [Core Primitives](./gitbook/core-primitives.md)
- [API Reference](./gitbook/api-reference.md)
- [Conformance](./gitbook/conformance.md)
- [Closepacks](./gitbook/closepacks.md)
- [Guides](./gitbook/guides.md)
- [Security Model](./gitbook/security-model.md)
- [FAQ](./gitbook/faq.md)

## Fastest onboarding path

1. Run `settld setup` (or `./bin/settld.js setup`), choose `quick`, and complete OTP login.
2. Let guided wallet funding complete (or run `settld wallet fund` + `settld wallet balance --watch --min-usdc 1`).
3. Activate your host and run `npm run mcp:probe`.
4. Run `npm run demo:mcp-paid-exa`.
5. Verify the first receipt:

```bash
jq -c 'first' artifacts/mcp-paid-exa/*/x402-receipts.export.jsonl > /tmp/settld-first-receipt.json
settld x402 receipt verify /tmp/settld-first-receipt.json --format json --json-out /tmp/settld-first-receipt.verify.json
```

Reference docs:

- `docs/QUICKSTART_MCP_HOSTS.md`
- `docs/QUICKSTART_MCP.md`
