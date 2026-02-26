# Signer provider plugins (tooling contract)

Signer provider plugins extend `nooterra-produce` with custom key custody and signing implementations (KMS/HSM/Vault/remote approval flows) without changing bundle protocol objects.

This is a **tooling** contract (not protocol v1). Verifiers remain unchanged.

## CLI usage

`nooterra-produce --signer plugin --signer-plugin <path|package> [--signer-plugin-export createSignerProvider] [--signer-plugin-config <json>] --gov-key-id <id> --server-key-id <id> ...`

## Plugin contract

Your plugin must export a function (default name: `createSignerProvider`):

- Signature: `async createSignerProvider({ config, env }) -> provider`

Where `provider` is an object implementing:

- `async getPublicKeyPem({ keyId }) -> publicKeyPem`
- `async sign({ keyId, algorithm, messageBytes, purpose, context }) -> { signatureBase64, signerReceipt? }`

Notes:

- `messageBytes` are the exact bytes to sign (typically 32 bytes: sha256 of canonical JSON).
- `purpose` is required and must be enforced by the provider (refuse unknown purposes).
- Do not log or return private key material.

## Packaging guidance

- If `--signer-plugin` is a path, it is resolved relative to the current working directory.
- If `--signer-plugin` is a package name, it must be resolvable via Node module resolution (installed in the environment where `nooterra-produce` runs).

