# Nooterra Runtime Public Quickstart (No Repo Clone)

Use this when you want a public user to connect the Nooterra runtime host to Nooterra MCP from npm.

Prereqs:

- Nooterra runtime host installed
- Node.js 20.x

## 1) Run setup

Interactive path:

```bash
npx -y nooterra@latest setup
```

Choose:

1. `host`: `nooterra`
2. setup mode: `quick`
3. wallet mode (`managed` recommended first)
4. OTP login/signup
5. run smoke when prompted

Non-interactive path:

```bash
npx -y nooterra@latest setup \
  --non-interactive \
  --host nooterra \
  --base-url https://api.nooterra.work \
  --tenant-id tenant_default \
  --nooterra-api-key 'sk_live_xxx.yyy' \
  --wallet-mode managed \
  --wallet-bootstrap remote \
  --profile-id engineering-spend \
  --smoke
```

## 2) Activate runtime

Restart the Nooterra runtime host after setup writes MCP config.

## 3) Verify tool wiring

In runtime chat/session, run:

- `Use the MCP tool nooterra_about with empty arguments and return only JSON.`

Expected result: JSON payload with Nooterra service metadata.

## 4) First paid check

Run:

- `Use tool nooterra_call with tool=nooterra.weather_current_paid and arguments={"city":"Chicago","unit":"f"}. Return only JSON.`

Expected result:

- successful paid call
- response includes Nooterra policy/decision/settlement metadata
