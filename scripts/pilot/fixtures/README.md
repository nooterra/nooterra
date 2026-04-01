# Pilot Fixtures

This directory expects locally-generated Ed25519 keypairs. These files are
gitignored and must never be committed.

## Required files

| File | Purpose |
|------|---------|
| `robot-keypair.json` | Robot identity keypair (public + private) |
| `server-signer.json` | Server-side signing keypair (public + private) |

## Generate keys

Use the project helper (if available):

```bash
npx ts-node scripts/pilot/generate-keys.ts
```

Or generate manually with Node.js:

```js
const { generateKeyPairSync } = require("crypto");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const keypair = {
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
};

require("fs").writeFileSync(
  "robot-keypair.json",
  JSON.stringify(keypair, null, 2) + "\n"
);
```

Repeat for `server-signer.json` (same format, separate key material).
