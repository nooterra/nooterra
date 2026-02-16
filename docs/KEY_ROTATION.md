# SettldPay Key Rotation Runbook

This runbook covers rotation for the SettldPay Ed25519 signing key used by:

- `POST /x402/gate/authorize-payment` token minting
- `GET /.well-known/settld-keys.json` public key discovery

## Current model

- Tokens include `kid` and are signed with the active server signer key.
- Verifiers resolve keys via `/.well-known/settld-keys.json`.
- API supports published fallback keys via:
  - `SETTLD_PAY_FALLBACK_KEYS` (JSON array of `{ keyId?, publicKeyPem }`)
  - `SETTLD_PAY_FALLBACK_PUBLIC_KEY_PEM`
  - `SETTLD_PAY_FALLBACK_KEY_ID`

## Planned rotation (normal)

1. Generate new Ed25519 keypair.
2. Deploy signer with new private key (but do not remove old key yet).
3. Publish keyset including both:
   - new active key
   - previous key as fallback
4. Switch signing to the new key.
5. Keep old key published for at least:
   - `max token TTL` (default 5m), plus
   - cache margin for well-known keyset refresh (recommend >=24h for external verifiers).
6. After the overlap window, remove old key from fallback list.

## Emergency rotation (key compromise)

1. Stop signing with the compromised key immediately.
2. Switch signer to a new keypair.
3. Publish a refreshed keyset with the compromised key removed from active use.
4. Notify providers/operators to refresh keyset immediately.
5. Review recent `authorize-payment` and verify flows for suspicious token use.

## Verification checks

Before/after rotation, run:

```bash
node --test test/settld-pay-token.test.js
node --test test/api-e2e-x402-authorize-payment.test.js
```

And manually confirm:

```bash
curl -fsS http://127.0.0.1:3000/.well-known/settld-keys.json
```

Response should include:

- active `kid`
- fallback `kid`(s) during overlap
- `kty=OKP`, `crv=Ed25519`, and `x` set for each key
