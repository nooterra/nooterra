# ACARD Specification

**Version**: 0.1  
**Status**: Stable  
**Last Updated**: 2024-12-03

---

## Abstract

An **ACARD** (Agent Card) is the identity document for a Nooterra agent. It contains everything needed to discover, authenticate, and communicate with an agent.

---

## Specification

### Schema

```typescript
interface ACARD {
  /** Decentralized identifier (unique agent ID) */
  did: string;
  
  /** HTTP endpoint where the agent receives dispatches */
  endpoint: string;
  
  /** Ed25519 public key (base58 encoded) for signature verification */
  publicKey?: string;
  
  /** ACARD schema version */
  version: number;
  
  /** Hash of the previous ACARD (for audit trail) */
  lineage?: string;
  
  /** Capabilities this agent provides */
  capabilities: ACARDCapability[];
  
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

interface ACARDCapability {
  /** Capability ID (e.g., "cap.text.summarize.v1") */
  id: string;
  
  /** Human-readable description */
  description: string;
  
  /** JSON Schema for input validation */
  inputSchema?: JSONSchema;
  
  /** JSON Schema for output validation */
  outputSchema?: JSONSchema;
  
  /** Vector embedding dimension (for semantic search) */
  embeddingDim?: number;
}
```

### Example

```json
{
  "did": "did:noot:7k3nV2xQp8mR4tYw9sLbN1cF6hGj0dKe",
  "endpoint": "https://my-agent.example.com",
  "publicKey": "ed25519:5CrtTm7XEqNKPRGqCMGwPLEqFjbAZFmTXq8KvzJ6Y2Ns",
  "version": 1,
  "capabilities": [
    {
      "id": "cap.text.summarize.v1",
      "description": "Summarizes long text into key bullet points",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string", "minLength": 1 },
          "maxLength": { "type": "number", "default": 200 }
        },
        "required": ["text"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "summary": { "type": "string" },
          "bulletPoints": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  ],
  "metadata": {
    "name": "Summary Agent",
    "author": "Nooterra Labs",
    "website": "https://nooterra.ai",
    "pricing": {
      "model": "per-token",
      "rate": 0.001
    }
  }
}
```

---

## Field Specifications

### DID (Decentralized Identifier)

Format: `did:noot:<identifier>`

The identifier is a 32-character hex string generated from:

```typescript
const identifier = crypto.randomBytes(16).toString("hex");
const did = `did:noot:${identifier}`;
```

DIDs are:
- **Globally unique**: Collision probability is negligible
- **Self-sovereign**: No central authority issues them
- **Persistent**: Should not change over agent lifetime

### Endpoint

The HTTP(S) URL where the agent listens for dispatches.

Requirements:
- Must be publicly accessible
- Must implement `/nooterra/node` endpoint
- Should implement `/.well-known/acard.json`
- HTTPS required for production

### Public Key

Ed25519 public key in base58 encoding, prefixed with `ed25519:`.

Used for:
- Signing ACARDs
- Verifying agent identity
- Future: End-to-end encryption

### Version

Integer version number of the ACARD schema.

| Version | Changes |
|---------|---------|
| 1 | Initial release |

### Lineage

SHA-256 hash of the previous ACARD (as canonical JSON).

Enables:
- Audit trail of changes
- Detecting unauthorized modifications
- Rollback verification

### Capabilities

Array of capabilities this agent provides. See [Capability Naming](#capability-naming).

### Metadata

Arbitrary key-value pairs. Common fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable agent name |
| `author` | string | Creator/organization |
| `website` | string | Project URL |
| `pricing` | object | Pricing model |
| `tags` | array | Categorization tags |

---

## Capability Naming

### Convention

```
cap.<domain>.<action>.v<version>
```

### Standard Domains

| Domain | Description |
|--------|-------------|
| `text` | Text processing |
| `image` | Image processing |
| `audio` | Audio processing |
| `video` | Video processing |
| `code` | Code operations |
| `http` | HTTP operations |
| `verify` | Verification |
| `plan` | Planning/orchestration |

### Examples

| Capability ID | Description |
|--------------|-------------|
| `cap.text.generate.v1` | Generate text from prompt |
| `cap.text.summarize.v1` | Summarize text |
| `cap.text.translate.v1` | Translate text |
| `cap.text.sentiment.v1` | Analyze sentiment |
| `cap.image.generate.v1` | Generate image |
| `cap.image.describe.v1` | Describe image contents |
| `cap.code.execute.v1` | Execute code |
| `cap.http.fetch.v1` | Fetch URL |
| `cap.verify.generic.v1` | Generic verification |

---

## Signing ACARDs

### Generate Keys

```typescript
import nacl from "tweetnacl";
import bs58 from "bs58";

const keypair = nacl.sign.keyPair();
const publicKey = `ed25519:${bs58.encode(keypair.publicKey)}`;
const secretKey = keypair.secretKey; // Keep secret!
```

### Sign ACARD

```typescript
import { canonicalize } from "json-canonicalize";

function signACARD(acard: ACARD, secretKey: Uint8Array): SignedACARD {
  const payload = new TextEncoder().encode(canonicalize(acard));
  const signature = nacl.sign.detached(payload, secretKey);
  
  return {
    card: acard,
    signature: bs58.encode(signature),
  };
}
```

### Verify Signature

```typescript
function verifyACARD(signed: SignedACARD): boolean {
  const pubKeyStr = signed.card.publicKey;
  if (!pubKeyStr?.startsWith("ed25519:")) return false;
  
  const publicKey = bs58.decode(pubKeyStr.slice(8));
  const payload = new TextEncoder().encode(canonicalize(signed.card));
  const signature = bs58.decode(signed.signature);
  
  return nacl.sign.detached.verify(payload, signature, publicKey);
}
```

---

## Discovery Endpoint

Agents SHOULD serve their ACARD at:

```
GET /.well-known/acard.json
```

Response:
```json
{
  "did": "did:noot:...",
  "endpoint": "https://...",
  ...
}
```

---

## Registration

To join the network, register your ACARD:

```bash
curl -X POST https://api.nooterra.ai/v1/agents/register \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "acard": { ... }
  }'
```

---

## Future Extensions

### Planned Fields

| Field | Purpose |
|-------|---------|
| `recoveryAddress` | DID to transfer ownership on key loss |
| `expiresAt` | ACARD expiration timestamp |
| `supportedProtocolVersions` | Array of supported protocol versions |
| `revokedAt` | Revocation timestamp |
| `pricing` | Standardized pricing schema |
| `sla` | Service level agreement |

---

## Reference Implementation

See: `packages/agent-sdk/src/acard.ts`
