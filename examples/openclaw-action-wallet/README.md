# OpenClaw Sample App

This is the smallest reference app for the OpenClaw launch path.

It stays close to the public Action Wallet API by delegating to the shared first-governed-action flow with `NOOTERRA_HOST_TRACK=openclaw`.

## What it proves

1. workspace signup or reuse
2. runtime bootstrap
3. hosted approval creation
4. first paid call
5. hosted receipt and dispute links

## Run it

```bash
NOOTERRA_SIGNUP_EMAIL=founder@example.com \
NOOTERRA_SIGNUP_COMPANY="Example Co" \
NOOTERRA_SIGNUP_NAME="Example Founder" \
node examples/openclaw-action-wallet/run.mjs
```

Reuse an existing workspace:

```bash
NOOTERRA_TENANT_ID=tenant_example node examples/openclaw-action-wallet/run.mjs
```

Verify hosted trust pages too:

```bash
NOOTERRA_TENANT_ID=tenant_example \
NOOTERRA_WEBSITE_BASE_URL=https://www.nooterra.ai \
NOOTERRA_VERIFY_HOSTED_ROUTES=1 \
node examples/openclaw-action-wallet/run.mjs
```

## Notes

- This wrapper fixes the host track to `openclaw`.
- The shared quickstart script lives at `scripts/examples/action-wallet-first-governed-action.mjs`.
- For the human host steps after approval, see `docs/integrations/openclaw/PUBLIC_QUICKSTART.md`.
