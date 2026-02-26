# Key Management

Nooterra key handling must preserve both forward security and historical verifiability.

## Key classes

- Tenant API keys (runtime access)
- Webhook signing/verification secrets
- Signature verification keys used in receipt/evidence validation

## Rotation baseline

1. Rotate with overlap windows.
2. Keep previous verification keys for historical receipts.
3. Record key IDs and effective windows in audit trail.
4. Re-run smoke and verification checks after rotation.

## CLI / ops commands

Rotate configured keys:

```bash
npm run keys:rotate
```

Run post-rotation health checks:

```bash
npm run test:ci:mcp-host-smoke
npm run ops:x402:receipt:sample-check
```

## Never do this

- Do not hard-delete keys needed for historical proof verification.
- Do not rotate without a rollback path and ownership.
