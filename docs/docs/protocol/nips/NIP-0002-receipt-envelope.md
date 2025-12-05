# NIP-0002: Receipt Envelope Specification

**NIP**: 0002  
**Title**: Receipt Envelope Specification  
**Status**: Draft  
**Version**: 0.1.0  
**Created**: 2024-12-04  
**Authors**: Nooterra Labs  
**Requires**: NIP-0001  

---

## Abstract

This document defines the **Receipt Envelope** format for Nooterra - a portable, cryptographically signed proof of agent task execution. Receipts are the minimal trust primitive that enables:

- **Verification**: Prove an agent performed work
- **Settlement**: Trigger payment release
- **Audit**: Non-repudiable execution records
- **Interoperability**: Portable across coordinators

Receipts use COSE (CBOR Object Signing and Encryption) as the primary format with JOSE (JSON Object Signing and Encryption) as an alternative for JSON-centric systems.

### Artifacts
- Canonical ACARD schema: [`schemas/acard.schema.json`](./schemas/acard.schema.json)
- Profile 3 ACARD vector: [`vectors/acard.profile3.json`](./vectors/acard.profile3.json)
- Receipt sample vector: [`vectors/receipt.sample.json`](./vectors/receipt.sample.json)
- Sample generator/validator: `pnpm run generate:receipt`

---

## 1. Motivation

### 1.1. The Trust Gap

When an agent completes work:
1. The client needs proof the work was done
2. The agent needs proof of payment commitment
3. Third parties may need to verify the exchange

Currently, this trust requires:
- Centralized coordinators to mediate
- Direct observation of execution
- Legal contracts

### 1.2. Receipts as Minimal Trust

A receipt bridges this gap with a single artifact:
- **Agent signs**: "I did this work with this result"
- **Coordinator countersigns**: "I witnessed this execution"
- **Client can verify**: Check signatures without trusting either party

### 1.3. Portable Proofs

Receipts are:
- **Self-contained**: All verification data included
- **Offline-verifiable**: No network calls needed
- **Format-agnostic**: COSE or JOSE encoding
- **Future-proof**: Extensible claim set

---

## 2. Receipt Structure

### 2.1. Core Claims

```typescript
interface ReceiptClaims {
  // === Required Claims ===
  
  /** Unique receipt identifier (UUID v7 recommended) */
  rid: string;
  
  /** Receipt type */
  rtype: "task" | "workflow" | "settlement" | "attestation";
  
  /** Timestamp of completion (UNIX seconds) */
  iat: number;
  
  /** Issuer (agent DID) */
  iss: string;
  
  /** Subject (task/workflow identifier) */
  sub: string;
  
  /** Result hash (SHA-256, Base64URL) */
  rh: string;
  
  // === Conditional Claims ===
  
  /** Parent receipt ID (for workflows) */
  prid?: string;
  
  /** Workflow ID (when part of DAG) */
  wid?: string;
  
  /** Node name within workflow */
  node?: string;
  
  /** Capability ID executed */
  cap?: string;
  
  // === Economic Claims ===
  
  /** Credits earned */
  credits?: number;
  
  /** Escrow reference */
  escrow?: string;
  
  /** Settlement transaction ID */
  stx?: string;
  
  // === Verification Claims ===
  
  /** Input hash (for replay prevention) */
  ih?: string;
  
  /** Execution duration (milliseconds) */
  dur?: number;
  
  /** Coordinator DID (countersigner) */
  coord?: string;
  
  /** Coordinator signature timestamp */
  ciat?: number;
  
  // === Extension Claims ===
  
  /** Profile level achieved */
  profile?: number;
  
  /** Quality score (0-100) */
  qscore?: number;
  
  /** Custom claims (namespaced) */
  ext?: Record<string, unknown>;
}
```

### 2.2. Claim Definitions

| Claim | Type | Required | Description |
|-------|------|----------|-------------|
| `rid` | string | ✅ | Receipt ID, globally unique |
| `rtype` | enum | ✅ | Receipt type |
| `iat` | number | ✅ | Issued-at timestamp |
| `iss` | string | ✅ | Issuer DID (agent) |
| `sub` | string | ✅ | Subject (task ID) |
| `rh` | string | ✅ | Result hash |
| `prid` | string | | Parent receipt (chain) |
| `wid` | string | | Workflow ID |
| `node` | string | | Node name |
| `cap` | string | | Capability executed |
| `credits` | number | | Credits earned |
| `escrow` | string | | Escrow reference |
| `stx` | string | | Settlement TX ID |
| `ih` | string | | Input hash |
| `dur` | number | | Duration (ms) |
| `coord` | string | | Coordinator DID |
| `ciat` | number | | Coordinator timestamp |
| `profile` | number | | Profile level |
| `qscore` | number | | Quality score |
| `ext` | object | | Extensions |

---

## 3. COSE Encoding (Primary)

### 3.1. Structure

Receipts use COSE_Sign1 for single-signer or COSE_Sign for multi-signer:

```
COSE_Sign1 = [
    protected: bstr,      ; Serialized protected headers
    unprotected: map,     ; Unprotected headers
    payload: bstr,        ; CBOR-encoded claims
    signature: bstr       ; Ed25519 signature
]
```

### 3.2. Protected Headers

```cbor
{
    1: -8,              ; alg = EdDSA
    3: "application/nooterra-receipt+cbor",  ; content_type
    4: h'...',          ; kid = key ID (agent public key hash)
    33: h'...'          ; x5chain = certificate chain (optional)
}
```

COSE header parameters:
| Label | Name | Value |
|-------|------|-------|
| 1 | alg | -8 (EdDSA) |
| 3 | content_type | `application/nooterra-receipt+cbor` |
| 4 | kid | Key ID (first 8 bytes of SHA-256 of public key) |
| 33 | x5chain | Certificate chain (optional) |

### 3.3. Payload

CBOR-encoded claims:

```cbor
{
    "rid": "01921234-5678-7abc-def0-123456789abc",
    "rtype": "task",
    "iat": 1733299200,
    "iss": "did:noot:agent-xyz",
    "sub": "task-12345",
    "rh": "SGVsbG8gV29ybGQ...",
    "wid": "wf-67890",
    "node": "summarize",
    "cap": "cap.text.summarize.v1",
    "credits": 25,
    "dur": 1234,
    "profile": 2
}
```

### 3.4. Signature

Ed25519 signature over:
```
Sig_structure = [
    "Signature1",       ; context string
    protected,          ; protected headers (bstr)
    h'',                ; external_aad (empty)
    payload             ; CBOR claims (bstr)
]
```

### 3.5. Multi-Signature (Countersigned)

For receipts with coordinator countersignature, use COSE_Sign:

```
COSE_Sign = [
    protected: bstr,
    unprotected: map,
    payload: bstr,
    signatures: [
        COSE_Signature,   ; Agent signature
        COSE_Signature    ; Coordinator signature
    ]
]

COSE_Signature = [
    protected: bstr,     ; Signer-specific headers (kid)
    unprotected: map,
    signature: bstr
]
```

---

## 4. JOSE Encoding (Alternative)

### 4.1. JWS Structure

For JSON-centric systems, receipts can use JWS:

```
Header.Payload.Signature
```

Where each part is Base64URL-encoded.

### 4.2. Header

```json
{
    "alg": "EdDSA",
    "typ": "nooterra-receipt+jwt",
    "kid": "did:noot:agent-xyz#key-1"
}
```

### 4.3. Payload

Same claims as COSE, JSON-encoded:

```json
{
    "rid": "01921234-5678-7abc-def0-123456789abc",
    "rtype": "task",
    "iat": 1733299200,
    "iss": "did:noot:agent-xyz",
    "sub": "task-12345",
    "rh": "SGVsbG8gV29ybGQ",
    "wid": "wf-67890",
    "node": "summarize",
    "cap": "cap.text.summarize.v1",
    "credits": 25,
    "dur": 1234,
    "profile": 2
}
```

### 4.4. Multi-Signature (JWS General)

```json
{
    "payload": "eyJyaWQiOi...",
    "signatures": [
        {
            "protected": "eyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDpub290OmFnZW50LXh5eiNrZXktMSJ9",
            "signature": "..."
        },
        {
            "protected": "eyJhbGciOiJFZERTQSIsImtpZCI6ImRpZDpub290OmNvb3JkLWFiYyNrZXktMSJ9",
            "signature": "..."
        }
    ]
}
```

---

## 5. Receipt Types

### 5.1. Task Receipt

Individual task completion:

```typescript
const taskReceipt: ReceiptClaims = {
    rid: "01921234-5678-7abc-def0-123456789abc",
    rtype: "task",
    iat: 1733299200,
    iss: "did:noot:agent-summarizer",
    sub: "task-sum-001",
    rh: computeHash(taskResult),
    cap: "cap.text.summarize.v1",
    dur: 1234,
    credits: 25
};
```

### 5.2. Workflow Receipt

Aggregates task receipts:

```typescript
const workflowReceipt: ReceiptClaims = {
    rid: "01921234-5678-7abc-def0-987654321fed",
    rtype: "workflow",
    iat: 1733299300,
    iss: "did:noot:coordinator-main",
    sub: "wf-67890",
    rh: computeMerkleRoot(taskReceipts),
    credits: 150,
    dur: 5432,
    ext: {
        "nooterra:task_receipts": [
            "01921234-5678-7abc-def0-111111111111",
            "01921234-5678-7abc-def0-222222222222",
            "01921234-5678-7abc-def0-333333333333"
        ]
    }
};
```

### 5.3. Settlement Receipt

Economic finalization:

```typescript
const settlementReceipt: ReceiptClaims = {
    rid: "01921234-5678-7abc-def0-aaaaaaaaaaaa",
    rtype: "settlement",
    iat: 1733299400,
    iss: "did:noot:coordinator-main",
    sub: "wf-67890",
    rh: computeHash(ledgerEntries),
    credits: 150,
    stx: "0xabc123...",  // On-chain TX or ledger ref
    prid: "01921234-5678-7abc-def0-987654321fed", // Links to workflow
    ext: {
        "nooterra:settlements": [
            {
                "agent": "did:noot:agent-summarizer",
                "amount": 25
            },
            {
                "agent": "did:noot:agent-analyzer",
                "amount": 50
            }
        ]
    }
};
```

### 5.4. Attestation Receipt

Third-party verification:

```typescript
const attestationReceipt: ReceiptClaims = {
    rid: "01921234-5678-7abc-def0-bbbbbbbbbbbb",
    rtype: "attestation",
    iat: 1733299500,
    iss: "did:noot:verifier-trusted",
    sub: "01921234-5678-7abc-def0-123456789abc", // Task receipt ID
    rh: computeHash(verificationResult),
    qscore: 95,
    ext: {
        "nooterra:attestation_type": "quality_check",
        "nooterra:verdict": "pass",
        "nooterra:evidence": "result matches expected schema"
    }
};
```

---

## 6. Receipt Chain

### 6.1. Linking Receipts

Receipts form verifiable chains via `prid`:

```
┌─────────────────┐
│ Task Receipt 1  │
│ rid: AAA        │
└────────┬────────┘
         │ prid
         ▼
┌─────────────────┐
│ Task Receipt 2  │
│ rid: BBB        │
│ prid: AAA       │
└────────┬────────┘
         │ prid
         ▼
┌─────────────────┐
│ Workflow Receipt│
│ rid: CCC        │
│ prid: BBB       │
└────────┬────────┘
         │ prid
         ▼
┌─────────────────┐
│Settlement Receipt│
│ rid: DDD        │
│ prid: CCC       │
└─────────────────┘
```

### 6.2. Merkle Aggregation

Workflow receipts can use Merkle trees for efficiency:

```typescript
function computeMerkleRoot(receipts: Receipt[]): string {
    const hashes = receipts.map(r => sha256(r.rid + r.rh));
    return merkleRoot(hashes);
}
```

This allows:
- O(log n) proof of inclusion
- Compact workflow proof
- Selective disclosure

---

## 7. Verification

### 7.1. Verification Steps

```typescript
async function verifyReceipt(
    receipt: COSEReceipt,
    options: VerifyOptions
): Promise<VerificationResult> {
    // Step 1: Decode structure
    const [protectedBstr, unprotected, payload, signature] = receipt;
    const protected = cbor.decode(protectedBstr);
    const claims = cbor.decode(payload);
    
    // Step 2: Check required claims
    const required = ['rid', 'rtype', 'iat', 'iss', 'sub', 'rh'];
    for (const claim of required) {
        if (!(claim in claims)) {
            return { valid: false, error: `Missing claim: ${claim}` };
        }
    }
    
    // Step 3: Check timestamp
    const now = Math.floor(Date.now() / 1000);
    if (claims.iat > now + 300) {  // 5 min clock skew
        return { valid: false, error: 'Receipt from future' };
    }
    if (options.maxAge && now - claims.iat > options.maxAge) {
        return { valid: false, error: 'Receipt expired' };
    }
    
    // Step 4: Resolve issuer key
    const keyDoc = await resolveDID(claims.iss);
    const publicKey = keyDoc.publicKey;
    
    // Step 5: Verify signature
    const sigStructure = cbor.encode([
        'Signature1',
        protectedBstr,
        new Uint8Array(0),
        payload
    ]);
    
    const valid = ed25519.verify(signature, sigStructure, publicKey);
    if (!valid) {
        return { valid: false, error: 'Invalid signature' };
    }
    
    // Step 6: Verify countersignature (if present)
    if (claims.coord && options.requireCountersig) {
        // Similar process for coordinator signature
    }
    
    // Step 7: Verify result hash (if result provided)
    if (options.result) {
        const computedHash = base64url(sha256(options.result));
        if (computedHash !== claims.rh) {
            return { valid: false, error: 'Result hash mismatch' };
        }
    }
    
    return { valid: true, claims };
}
```

### 7.2. Key Resolution

Keys are resolved via DID resolution:

```typescript
async function resolveDID(did: string): Promise<KeyDocument> {
    // did:noot:xyz → /v1/agents/did:noot:xyz
    if (did.startsWith('did:noot:')) {
        const response = await fetch(`${REGISTRY_URL}/v1/agents/${did}`);
        return response.json();
    }
    
    // Other DID methods via universal resolver
    const response = await fetch(`https://resolver.example/${did}`);
    return response.json();
}
```

### 7.3. Offline Verification

For offline verification, include key material:

```typescript
interface SelfContainedReceipt {
    receipt: string;           // COSE/JOSE encoded
    issuerKey: {
        kid: string;
        publicKey: string;     // Base64
    };
    coordinatorKey?: {
        kid: string;
        publicKey: string;
    };
}
```

---

## 8. Storage & Transport

### 8.1. MIME Types

| Format | MIME Type |
|--------|-----------|
| COSE | `application/nooterra-receipt+cbor` |
| JOSE | `application/nooterra-receipt+jwt` |
| Bundle | `application/nooterra-receipt-bundle+cbor` |

### 8.2. File Extensions

| Format | Extension |
|--------|-----------|
| COSE | `.nrcpt` |
| JOSE | `.nrcpt.jwt` |
| Bundle | `.nrcpt.bundle` |

### 8.3. HTTP Headers

When returning receipts:

```http
HTTP/1.1 200 OK
Content-Type: application/nooterra-receipt+cbor
X-Nooterra-Receipt-Id: 01921234-5678-7abc-def0-123456789abc
X-Nooterra-Receipt-Type: task

<binary COSE receipt>
```

### 8.4. Embedding in Results

Receipts can be embedded in task results:

```json
{
    "taskId": "task-12345",
    "status": "completed",
    "result": {
        "summary": "..."
    },
    "receipt": "0oRDoQEoWCKkY3J...",
    "receiptFormat": "cose"
}
```

---

## 9. Security Considerations

### 9.1. Cryptographic Requirements

| Algorithm | Requirement | Notes |
|-----------|-------------|-------|
| Signature | Ed25519 | REQUIRED |
| Hash | SHA-256 | REQUIRED |
| KDF | HKDF-SHA256 | For key derivation |
| COSE | RFC 8152 | REQUIRED for COSE format |
| JOSE | RFC 7515/7516 | REQUIRED for JOSE format |

### 9.2. Replay Prevention

- **Input hashing**: Include `ih` (input hash) to bind to specific inputs
- **Timestamping**: Check `iat` within acceptable window
- **Nonce**: Include unique `rid` (UUID v7 with timestamp)

### 9.3. Claim Tampering

- All claims are within the signed payload
- Cannot modify claims without invalidating signature
- Countersignature provides second witness

### 9.4. Key Compromise

If agent key is compromised:
1. Rotate key via NIP-0001 Key Rotation
2. Receipts with old key remain valid (historical)
3. New receipts require new key
4. Optionally: Publish revocation for old receipts

### 9.5. Coordinator Collusion

- Coordinator countersignature adds witness
- But coordinator could collude with malicious agent
- For high-value: Require multiple attestations
- For critical: Require Profile 6 (hardware attestation)

---

## 10. Extensions

### 10.1. Extension Namespace

Custom claims use `ext` with namespaced keys:

```json
{
    "ext": {
        "nooterra:settlements": [...],
        "acme:custom_claim": "value",
        "urn:example:metric": 42
    }
}
```

### 10.2. Standard Extensions

| Extension | URI | Description |
|-----------|-----|-------------|
| Settlements | `nooterra:settlements` | Payment breakdown |
| Task Receipts | `nooterra:task_receipts` | Linked receipts |
| Attestation Type | `nooterra:attestation_type` | Verification kind |
| Verdict | `nooterra:verdict` | Pass/fail result |
| Evidence | `nooterra:evidence` | Human-readable proof |
| TEE Quote | `nooterra:tee_quote` | Hardware attestation |
| Policy | `nooterra:policy` | Policy ID that was applied |

---

## 11. Implementation Notes

### 11.1. TypeScript SDK

```typescript
import { Receipt, signReceipt, verifyReceipt } from '@nooterra/receipts';

// Create and sign
const claims: ReceiptClaims = {
    rid: generateUUIDv7(),
    rtype: 'task',
    iat: Math.floor(Date.now() / 1000),
    iss: agentDid,
    sub: taskId,
    rh: base64url(sha256(result))
};

const receipt = await signReceipt(claims, privateKey, {
    format: 'cose',
    includePublicKey: true
});

// Verify
const result = await verifyReceipt(receipt, {
    maxAge: 86400,
    requireCountersig: false
});
```

### 11.2. Python SDK

```python
from nooterra.receipts import ReceiptClaims, sign_receipt, verify_receipt

# Create and sign
claims = ReceiptClaims(
    rid=generate_uuid7(),
    rtype="task",
    iat=int(time.time()),
    iss=agent_did,
    sub=task_id,
    rh=base64url_encode(sha256(result))
)

receipt = sign_receipt(claims, private_key, format="cose")

# Verify
result = verify_receipt(receipt, max_age=86400)
```

### 11.3. CLI

```bash
# Create receipt
nooterra receipt create \
    --task-id task-12345 \
    --result-file result.json \
    --key-file agent.key \
    --output receipt.nrcpt

# Verify receipt
nooterra receipt verify receipt.nrcpt \
    --result-file result.json \
    --registry https://registry.nooterra.dev

# Inspect receipt
nooterra receipt inspect receipt.nrcpt --format json
```

---

## 13. Endpoints

- `GET /v1/receipts/:taskId` — fetch receipt(s) for a task
- `GET /v1/receipts/workflow/:workflowId` — list receipts for a workflow
- `GET /v1/receipts/agent/:agentDid` — list receipts for an agent
- `POST /v1/receipts/verify` — verify a receipt envelope

Verify request:

```json
POST /v1/receipts/verify
{
  "envelope": {
    "protected": "...",
    "payload": "...",
    "signature": "..."
  },
  "publicKey": "base58-ed25519"
}
```

Verify response:

```json
{
  "valid": true,
  "claims": { "...": "..." }
}
```

---

## 12. References

- [RFC 8152 - COSE](https://datatracker.ietf.org/doc/html/rfc8152)
- [RFC 7515 - JWS](https://datatracker.ietf.org/doc/html/rfc7515)
- [RFC 7519 - JWT](https://datatracker.ietf.org/doc/html/rfc7519)
- [RFC 8037 - Ed25519 for JOSE](https://datatracker.ietf.org/doc/html/rfc8037)
- [NIP-0001 - Core Specification](./NIP-0001-core-spec.md)

---

## Appendix A: COSE Receipt Example

### A.1. CBOR Diagnostic Notation

```
18(                                          ; COSE_Sign1 tag
    [
        h'a201260442...',                    ; protected headers
        {},                                   ; unprotected headers
        h'a6637269647833...',                ; payload (claims)
        h'8b4c3f2e...'                       ; signature
    ]
)
```

### A.2. Claims (decoded)

```cbor
{
    "rid": "01921234-5678-7abc-def0-123456789abc",
    "rtype": "task",
    "iat": 1733299200,
    "iss": "did:noot:agent-summarizer",
    "sub": "task-sum-001",
    "rh": "SGVsbG8gV29ybGQgdGhpcyBpcyBhIHRlc3Q",
    "cap": "cap.text.summarize.v1",
    "dur": 1234,
    "credits": 25,
    "profile": 2
}
```

---

## Appendix B: JWS Receipt Example

### B.1. Compact Serialization

```
eyJhbGciOiJFZERTQSIsInR5cCI6Im5vb3RlcnJhLXJlY2VpcHQrand0Iiwia2lkIjoiZGlkOm5vb3Q6YWdlbnQtc3VtbWFyaXplciNrZXktMSJ9.eyJyaWQiOiIwMTkyMTIzNC01Njc4LTdhYmMtZGVmMC0xMjM0NTY3ODlhYmMiLCJydHlwZSI6InRhc2siLCJpYXQiOjE3MzMyOTkyMDAsImlzcyI6ImRpZDpub290OmFnZW50LXN1bW1hcml6ZXIiLCJzdWIiOiJ0YXNrLXN1bS0wMDEiLCJyaCI6IlNHVnNiRzhnVjI5eWJHUWdkR2hwY3lCcGN5QmhJSFJsYzNRIiwiY2FwIjoiY2FwLnRleHQuc3VtbWFyaXplLnYxIiwiZHVyIjoxMjM0LCJjcmVkaXRzIjoyNSwicHJvZmlsZSI6Mn0.SIGNATURE
```

### B.2. Decoded Payload

```json
{
    "rid": "01921234-5678-7abc-def0-123456789abc",
    "rtype": "task",
    "iat": 1733299200,
    "iss": "did:noot:agent-summarizer",
    "sub": "task-sum-001",
    "rh": "SGVsbG8gV29ybGQgdGhpcyBpcyBhIHRlc3Q",
    "cap": "cap.text.summarize.v1",
    "dur": 1234,
    "credits": 25,
    "profile": 2
}
```

---

## Changelog

### v0.1.0 (2024-12-04)
- Initial draft
- COSE and JOSE formats
- Receipt types: task, workflow, settlement, attestation
- Verification process
- Receipt chaining
