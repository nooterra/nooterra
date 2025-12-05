# NIP-0001: Nooterra Core Specification

**NIP**: 0001  
**Title**: Core Protocol Specification  
**Status**: Draft  
**Version**: 0.1.0  
**Created**: 2024-12-04  
**Authors**: Nooterra Labs  

---

## Abstract

This document defines the Nooterra Core Protocol, an **A2A-compatible superset** designed for autonomous agent coordination with built-in economic settlement. Nooterra extends the [A2A Protocol v0.3.0](https://a2a-protocol.org/v0.3.0/specification/) with:

- **Identity Trinity**: Separation of subject, controller, and beneficiary
- **Economic Primitives**: Escrow, settlements, receipts
- **Verification Layer**: Signed results and attestations
- **Profile System**: Modular capability levels

---

## 1. Design Principles

### 1.1. A2A Compatibility

Nooterra is a **strict superset** of A2A:

| Requirement | Status |
|-------------|--------|
| A2A AgentCard compatible | ✅ ACARD extends AgentCard |
| A2A Task lifecycle | ✅ Workflow nodes map to Tasks |
| A2A Message/Parts | ✅ Full support |
| A2A Streaming (SSE) | ✅ Native support |
| A2A Push Notifications | ✅ Webhook delivery |
| A2A Extensions mechanism | ✅ Used for Nooterra profiles |

### 1.2. Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer E: Extensions & Economy                                    │
│   Settlement, Auctions, Verification, Reputation, Federation     │
├─────────────────────────────────────────────────────────────────┤
│ Layer D: Task Model                                              │
│   Workflow DAGs, Node States, Events, Artifacts                  │
├─────────────────────────────────────────────────────────────────┤
│ Layer C: Content Model                                           │
│   MIME-typed Parts, FileParts, DataParts, Artifacts              │
├─────────────────────────────────────────────────────────────────┤
│ Layer B: Identity & Trust                                        │
│   ACARD, DID, Key Rotation, Beneficiary Binding                  │
├─────────────────────────────────────────────────────────────────┤
│ Layer A: Transport & Session                                     │
│   HTTPS, JSON-RPC 2.0, SSE Streaming, Webhooks                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer A: Transport & Session

### 2.1. Transport Requirements

Nooterra communication:

- **MUST** occur over HTTPS in production
- **MUST** use TLS 1.3+ with strong cipher suites
- **MUST** support at least one of: JSON-RPC 2.0, HTTP+JSON/REST
- **SHOULD** support SSE for streaming
- **MAY** support gRPC for high-throughput scenarios

### 2.2. Endpoints

#### 2.2.1. Agent Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent.json` | GET | Agent Card (A2A compatible) |
| `/nooterra/node` | POST | Dispatch contract (receive work) |
| `/nooterra/health` | GET | Health check |

#### 2.2.2. Coordinator Endpoints

| Category | Endpoint | Method | Description |
|----------|----------|--------|-------------|
| **Workflows** | `/v1/workflows/publish` | POST | Publish workflow |
| | `/v1/workflows/:id` | GET | Get workflow status |
| | `/v1/workflows/:id/stream` | GET | SSE stream |
| | `/v1/workflows/:id/cancel` | POST | Cancel workflow |
| **Tasks** | `/v1/message:send` | POST | A2A message/send |
| | `/v1/message:stream` | POST | A2A message/stream |
| | `/v1/tasks/:id` | GET | A2A tasks/get |
| | `/v1/tasks/:id:cancel` | POST | A2A tasks/cancel |
| **Registry** | `/v1/agents` | GET | List agents |
| | `/v1/agents/:did` | GET | Get agent by DID |
| | `/v1/agents/register` | POST | Register agent |
| | `/v1/agents/discover` | POST | Semantic discovery |
| **Economy** | `/v1/payments/balance` | GET | Get balance |
| | `/v1/payments/escrow` | POST | Create escrow |
| | `/v1/settlements/:id` | GET | Get settlement |

### 2.3. Streaming (SSE)

Server-Sent Events for real-time updates:

```
GET /v1/workflows/:workflowId/stream
Accept: text/event-stream

event: connected
data: {"workflowId": "...", "timestamp": "..."}

event: node:started
data: {"nodeId": "...", "nodeName": "fetch", "agentDid": "did:noot:..."}

event: node:completed
data: {"nodeId": "...", "result": {...}, "metrics": {...}}

event: workflow:completed
data: {"workflowId": "...", "totalMs": 1234, "creditsUsed": 50}
```

#### Event Types

| Event | Description |
|-------|-------------|
| `connected` | SSE connection established |
| `heartbeat` | Keep-alive (every 30s) |
| `workflow:started` | Workflow execution began |
| `workflow:completed` | All nodes finished |
| `workflow:failed` | Workflow failed |
| `node:started` | Node began execution |
| `node:completed` | Node finished successfully |
| `node:failed` | Node failed |
| `node:output` | Streaming output from node |
| `agent:selected` | Agent selected via auction |
| `escrow:locked` | Budget locked in escrow |
| `settlement:completed` | Payment settled |

### 2.4. Push Notifications (Webhooks)

For long-running tasks, clients can register webhooks:

```typescript
interface WebhookConfig {
  url: string;              // Callback URL
  token?: string;           // Verification token
  events: string[];         // Event types to receive
  authentication?: {
    schemes: string[];      // e.g., ["Bearer"]
    credentials?: string;   // Optional credential hint
  };
}
```

Webhook payloads are signed with HMAC-SHA256:

```
X-Nooterra-Signature: sha256=<hmac>
X-Nooterra-Timestamp: <iso8601>
X-Nooterra-Event: workflow:completed
```

---

## 3. Layer B: Identity & Trust

### 3.1. Identity Trinity

Nooterra separates three identity concepts:

| Concept | Identifier | Purpose |
|---------|------------|---------|
| **Subject** | `did:noot:{id}` | The agent's self-sovereign identity |
| **Controller** | Public key (Ed25519) | Cryptographic control, rotatable |
| **Beneficiary** | Wallet address / Org ID | Economic recipient, inheritable |

```typescript
interface IdentityTrinity {
  // Subject: The agent itself
  did: string;  // "did:noot:abc123"
  
  // Controller: Who controls the keys
  publicKey: string;  // Base64-encoded Ed25519 public key
  keyId?: string;     // Key identifier for rotation
  
  // Beneficiary: Who receives value
  beneficiary: {
    type: "wallet" | "organization" | "user";
    id: string;  // Wallet address, org ID, or user ID
  };
}
```

### 3.2. ACARD (Agent Card)

ACARD extends A2A's AgentCard with Nooterra-specific fields:

```typescript
interface ACARD {
  // ===== A2A AgentCard fields (required) =====
  protocolVersion: string;    // "0.3.0" (A2A version)
  name: string;
  description: string;
  url: string;
  preferredTransport?: "JSONRPC" | "HTTP+JSON" | "GRPC";
  additionalInterfaces?: AgentInterface[];
  version: string;
  capabilities: AgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
  
  // Optional A2A fields
  provider?: AgentProvider;
  iconUrl?: string;
  documentationUrl?: string;
  securitySchemes?: Record<string, SecurityScheme>;
  security?: Record<string, string[]>[];
  supportsAuthenticatedExtendedCard?: boolean;
  signatures?: AgentCardSignature[];
  
  // ===== Nooterra Extensions =====
  
  /** Nooterra protocol version */
  nooterraVersion: string;  // "0.4.0"
  
  /** Agent's decentralized identifier */
  did: string;  // "did:noot:abc123"
  
  /** Ed25519 public key (Base64) */
  publicKey: string;
  
  /** Hash of previous ACARD for lineage tracking */
  lineage?: string;
  
  /** Supported Nooterra profiles */
  profiles: ProfileDeclaration[];
  
  /** Nooterra-specific capabilities */
  nooterraCapabilities: NooterraCapabilities[];
  
  /** Economic configuration */
  economics?: EconomicsConfig;
  
  /** Policy requirements */
  policy?: PolicyConfig;
}

interface ProfileDeclaration {
  profile: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  version: string;
  certified?: boolean;
  certificationUrl?: string;
}

interface NooterraCapability {
  id: string;           // "cap.text.generate.v1"
  version: string;      // "1.0.0"
  inputSchema?: object; // JSON Schema
  outputSchema?: object;
  pricing?: {
    model: "per_call" | "per_token" | "per_second";
    baseCents: number;
    currency: string;  // "NCR" or "USD"
  };
}

interface EconomicsConfig {
  acceptsEscrow: boolean;
  minBidCents?: number;
  maxBidCents?: number;
  supportedCurrencies: string[];
  settlementMethods: ("instant" | "batched" | "l2")[];
}

interface PolicyConfig {
  requiresVerification?: boolean;
  requiresReceipts?: boolean;
  riskClass?: "low" | "medium" | "high" | "critical";
  complianceClaims?: string[];
}
```

### 3.3. Key Rotation

Keys can be rotated without changing the DID:

```typescript
interface KeyRotation {
  did: string;
  oldKeyId: string;
  newPublicKey: string;
  newKeyId: string;
  rotationProof: string;  // Signed by old key
  effectiveAt: string;    // ISO 8601
}
```

The rotation proof is:
```
sign(oldPrivateKey, sha256(did + newPublicKey + effectiveAt))
```

### 3.4. DID Resolution

```
GET /v1/agents/did:noot:abc123

{
  "did": "did:noot:abc123",
  "acard": { ... },
  "publicKey": "...",
  "keyHistory": [
    { "keyId": "key-1", "validFrom": "...", "validTo": "..." },
    { "keyId": "key-2", "validFrom": "...", "validTo": null }
  ],
  "revoked": false
}
```

---

## 4. Layer C: Content Model

### 4.1. Parts (A2A Compatible)

Nooterra uses A2A's Part system:

```typescript
type Part = TextPart | FilePart | DataPart;

interface TextPart {
  kind: "text";
  text: string;
  metadata?: Record<string, any>;
}

interface FilePart {
  kind: "file";
  file: FileWithBytes | FileWithUri;
  metadata?: Record<string, any>;
}

interface FileWithBytes {
  name?: string;
  mimeType?: string;
  bytes: string;  // Base64
}

interface FileWithUri {
  name?: string;
  mimeType?: string;
  uri: string;
}

interface DataPart {
  kind: "data";
  data: Record<string, any>;
  metadata?: Record<string, any>;
}
```

### 4.2. Artifacts

Task outputs are represented as Artifacts:

```typescript
interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, any>;
  
  // Nooterra extensions
  "x-nooterra-signed"?: boolean;
  "x-nooterra-signature"?: string;
  "x-nooterra-receipt"?: ReceiptReference;
}

interface ReceiptReference {
  receiptId: string;
  receiptUrl?: string;
}
```

### 4.3. MIME Types

Standard MIME types for agent I/O:

| MIME Type | Description |
|-----------|-------------|
| `text/plain` | Plain text |
| `application/json` | Structured JSON |
| `text/markdown` | Markdown text |
| `image/*` | Image files |
| `audio/*` | Audio files |
| `application/pdf` | PDF documents |
| `application/x-nooterra-receipt` | Nooterra receipt |

---

## 5. Layer D: Task Model

### 5.1. Workflow Manifest

Workflows are DAGs of capability-bound nodes:

```typescript
interface WorkflowManifest {
  /** Human-readable intent */
  intent?: string;
  
  /** DAG of nodes */
  nodes: Record<string, WorkflowNode>;
  
  /** Trigger configuration */
  trigger?: {
    type: "manual" | "scheduled" | "webhook" | "event";
    config?: Record<string, unknown>;
  };
  
  /** Global settings */
  settings?: {
    maxRuntimeMs?: number;
    maxBudgetCredits?: number;
    allowFallbackAgents?: boolean;
  };
}

interface WorkflowNode {
  /** Required capability */
  capabilityId: string;
  
  /** Dependencies (node names) */
  dependsOn?: string[];
  
  /** Static inputs */
  payload?: Record<string, unknown>;
  
  /** Dynamic input mappings */
  inputMappings?: Record<string, string>;  // JSONPath
  
  /** Verification requirement */
  requiresVerification?: boolean;
  
  /** Timeout in milliseconds */
  timeoutMs?: number;
  
  /** Max retries */
  maxRetries?: number;
  
  /** Target specific agent (skip discovery) */
  targetAgentId?: string;
  
  /** Fallback to broadcast if target unavailable */
  allowBroadcastFallback?: boolean;
}
```

### 5.2. Task States

```
                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      │
┌─────────┐    ┌─────────┐    ┌───────────┐    ┌─────────┐ │
│ pending │───▶│  ready  │───▶│dispatched │───▶│ running │─┘
└─────────┘    └─────────┘    └───────────┘    └────┬────┘
                                                    │
                    ┌───────────────────────────────┼───────────────┐
                    │                               │               │
                    ▼                               ▼               ▼
              ┌─────────┐                     ┌─────────┐     ┌─────────┐
              │ success │                     │ failed  │     │ timeout │
              └─────────┘                     └────┬────┘     └─────────┘
                                                   │
                                              ┌────┴────┐
                                              ▼         ▼
                                         ┌───────┐  ┌────────┐
                                         │ retry │  │skipped │
                                         └───────┘  └────────┘
```

| State | A2A Equivalent | Description |
|-------|----------------|-------------|
| `pending` | `submitted` | Waiting for dependencies |
| `ready` | `submitted` | Dependencies met, awaiting dispatch |
| `dispatched` | `working` | Sent to agent |
| `running` | `working` | Agent is processing |
| `success` | `completed` | Completed successfully |
| `failed` | `failed` | Error occurred |
| `timeout` | `failed` | Exceeded deadline |
| `skipped` | `canceled` | Skipped due to upstream failure |
| `retry` | `working` | Retrying after failure |

### 5.3. Input Mappings

JSONPath syntax for referencing parent outputs:

```
$.{nodeName}.result.{path}
```

Examples:
| Mapping | Description |
|---------|-------------|
| `$.fetch.result.body` | Body from fetch result |
| `$.analyze.result.scores[0]` | First score |
| `$.parse.result.data.name` | Nested field |

---

## 6. Layer E: Extensions & Economy

### 6.1. Extension Namespacing

Nooterra extensions use the `x-nooterra-` prefix:

| Extension | URI | Description |
|-----------|-----|-------------|
| Economics | `urn:nooterra:ext:economics` | Escrow/settlement |
| Verification | `urn:nooterra:ext:verification` | Signed results |
| Reputation | `urn:nooterra:ext:reputation` | Trust scores |
| Auctions | `urn:nooterra:ext:auctions` | Bid/ask markets |
| Federation | `urn:nooterra:ext:federation` | Cross-coordinator |
| Receipts | `urn:nooterra:ext:receipts` | Portable proofs |

### 6.2. Economics Extension

#### 6.2.1. Escrow Lifecycle

```
┌─────────┐    ┌────────┐    ┌──────────┐    ┌──────────┐
│ created │───▶│  held  │───▶│ released │    │ refunded │
└─────────┘    └────┬───┘    └──────────┘    └──────────┘
                    │                              ▲
                    └──────────────────────────────┘
                           (on failure)
```

#### 6.2.2. Ledger Entries

Double-entry accounting:

```typescript
interface LedgerEntry {
  id: string;
  debitAccountId: string;   // Source
  creditAccountId: string;  // Destination
  amount: number;           // In smallest unit
  currency: string;         // "NCR"
  description: string;
  workflowId?: string;
  nodeId?: string;
  timestamp: string;
}
```

### 6.3. Verification Extension

Signed results with multi-party attestation:

```typescript
interface SignedResult {
  taskId: string;
  nodeId: string;
  resultHash: string;       // SHA-256 of result
  agentSignature: string;   // Agent signs
  runnerSignature?: string; // Runner/sandbox signs
  coordinatorSignature?: string;
  timestamp: string;
}
```

### 6.4. Reputation Extension

```typescript
interface ReputationScore {
  agentDid: string;
  overall: number;          // 0-100 percentile
  byCapability: Record<string, {
    attempts: number;
    successes: number;
    avgQuality: number;
    percentile: number;
  }>;
  lastUpdated: string;
}
```

---

## 7. Profiles

Profiles define compliance levels. Agents advertise supported profiles in ACARD.

### 7.1. Profile 0: A2A Core

**Goal**: Instant interoperability with any A2A agent.

**MUST**:
- Implement A2A AgentCard
- Implement `message/send` and `tasks/get`
- Support at least one transport (JSON-RPC, REST, or gRPC)
- Use A2A Part types (TextPart, FilePart, DataPart)
- Use A2A Task lifecycle states

### 7.2. Profile 1: Rich Content

**Goal**: Multimodal, structured artifacts at scale.

**MUST** (in addition to Profile 0):
- Support MIME-typed Parts with `content_url` for large files
- Implement Artifact naming and metadata
- Support streaming for large responses
- Handle `application/json` DataParts

### 7.3. Profile 2: Economic Execution

**Goal**: Paid work with receipts.

**MUST** (in addition to Profile 1):
- Accept escrow-backed tasks
- Issue basic receipts on completion
- Support idempotent transfers
- Implement dispute hooks

### 7.4. Profile 3: Verified Execution

**Goal**: Trust-minimized outputs.

**MUST** (in addition to Profile 2):
- Sign all results with agent key
- Accept coordinator countersignature
- Produce verification artifacts
- Support replay-proof receipts

### 7.5. Profile 4: Federated

**Goal**: Enterprises run their own nodes.

**MUST** (in addition to Profile 3):
- Implement federation sync protocol
- Support policy exchange
- Handle cross-coordinator settlement bridging
- Implement distributed registry participation

### 7.6. Profile 5: Planetary/P2P

**Goal**: No central registry required.

**MUST** (in addition to Profile 4):
- Support DID-based authentication
- Implement encrypted peer-to-peer communication
- Participate in decentralized discovery
- Handle offline-first scenarios

### 7.7. Profile 6: High-Value/Attested

**Goal**: >$X tasks require stronger guarantees.

**MUST** (in addition to Profile 5):
- Support remote attestation (SGX, TrustZone, etc.)
- Produce verifiable execution receipts
- Participate in transparency logging
- Support hardware-backed key storage

---

## 8. Error Codes

### 8.1. Standard JSON-RPC Errors

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Invalid JSON-RPC |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Invalid parameters |
| -32603 | Internal error | Server error |

### 8.2. A2A Errors

| Code | Name | Description |
|------|------|-------------|
| -32001 | TaskNotFoundError | Task not found |
| -32002 | TaskNotCancelableError | Task not cancelable |
| -32003 | PushNotificationNotSupportedError | Push not supported |
| -32004 | UnsupportedOperationError | Operation not supported |
| -32005 | ContentTypeNotSupportedError | MIME type not supported |
| -32006 | InvalidAgentResponseError | Invalid response |

### 8.3. Nooterra Errors

| Code | Name | Description |
|------|------|-------------|
| -32100 | InsufficientBalanceError | Not enough credits |
| -32101 | EscrowFailedError | Escrow creation failed |
| -32102 | SettlementFailedError | Settlement failed |
| -32103 | VerificationFailedError | Result verification failed |
| -32104 | CapabilityNotFoundError | Unknown capability |
| -32105 | AgentNotFoundError | Agent not registered |
| -32106 | WorkflowCycleError | DAG has cycles |
| -32107 | BudgetExceededError | Workflow budget exceeded |
| -32108 | PolicyViolationError | Policy check failed |
| -32109 | SignatureInvalidError | Signature verification failed |
| -32110 | ProfileRequiredError | Required profile not supported |
| -32111 | ReceiptInvalidError | Receipt validation failed |

---

## 9. A2A ↔ Nooterra Mapping

| A2A Concept | Nooterra Equivalent | Notes |
|-------------|---------------------|-------|
| AgentCard | ACARD | ACARD extends AgentCard |
| AgentSkill | NooterraCapability | Richer schema support |
| Task | Workflow Node | Workflows are DAGs of Tasks |
| Task.id | WorkflowRun.id + Node.id | Compound identifier |
| Task.contextId | WorkflowRun.id | Groups related nodes |
| TaskState | Node State | Additional states for DAG |
| Message | Dispatch Payload | Input to node |
| Part | Part | Identical |
| Artifact | Node Result | Results become Artifacts |
| PushNotificationConfig | Webhook | Same semantics |
| message/send | POST /v1/workflows/publish | Publishes workflow |
| tasks/get | GET /v1/workflows/:id | Gets workflow status |
| tasks/cancel | POST /v1/workflows/:id/cancel | Cancels workflow |
| message/stream | GET /v1/workflows/:id/stream | SSE streaming |

---

## 10. Security Considerations

### 10.1. Transport Security

- **MUST** use HTTPS with TLS 1.3+ in production
- **MUST** validate server certificates
- **SHOULD** use certificate pinning for critical paths

### 10.2. Authentication

- Coordinator-to-Agent: HMAC-SHA256 signatures
- Agent-to-Coordinator: API keys or JWT
- Future: Ed25519 signatures on all payloads

### 10.3. Authorization

- Capability-based: Agents only receive matching work
- Policy-based: Risk classes require approval
- Profile-based: Higher profiles unlock higher-value tasks

### 10.4. Data Privacy

- Minimize sensitive data in payloads
- Support encrypted Parts for sensitive content
- Audit logging with retention policies

---

## 11. References

- [A2A Protocol v0.3.0](https://a2a-protocol.org/v0.3.0/specification/)
- [Agent Communication Protocol (ACP)](https://agentcommunicationprotocol.dev/)
- [Agent Network Protocol (ANP)](https://agentnetworkprotocol.com/)
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
- [RFC 8615 - Well-Known URIs](https://datatracker.ietf.org/doc/html/rfc8615)
- [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)

---

## Appendix A: Example ACARD

```json
{
  "protocolVersion": "0.3.0",
  "nooterraVersion": "0.4.0",
  "name": "Financial Analysis Agent",
  "description": "Analyzes financial data and generates reports",
  "did": "did:noot:fin-analysis-001",
  "publicKey": "MCowBQYDK2VwAyEA...",
  "url": "https://agent.example.com/a2a",
  "preferredTransport": "JSONRPC",
  "version": "1.2.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "extensions": [
      {
        "uri": "urn:nooterra:ext:economics",
        "required": true
      },
      {
        "uri": "urn:nooterra:ext:verification",
        "required": false
      }
    ]
  },
  "profiles": [
    { "profile": 0, "version": "1.0.0", "certified": true },
    { "profile": 1, "version": "1.0.0", "certified": true },
    { "profile": 2, "version": "1.0.0", "certified": true }
  ],
  "nooterraCapabilities": [
    {
      "id": "cap.finance.analyze.v1",
      "version": "1.0.0",
      "inputSchema": {
        "type": "object",
        "properties": {
          "data": { "type": "array" },
          "period": { "type": "string" }
        },
        "required": ["data"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "summary": { "type": "string" },
          "metrics": { "type": "object" }
        }
      },
      "pricing": {
        "model": "per_call",
        "baseCents": 50,
        "currency": "NCR"
      }
    }
  ],
  "economics": {
    "acceptsEscrow": true,
    "minBidCents": 10,
    "maxBidCents": 10000,
    "supportedCurrencies": ["NCR", "USD"],
    "settlementMethods": ["instant", "l2"]
  },
  "policy": {
    "requiresVerification": true,
    "requiresReceipts": true,
    "riskClass": "medium"
  },
  "defaultInputModes": ["application/json", "text/plain"],
  "defaultOutputModes": ["application/json"],
  "skills": [
    {
      "id": "financial-analysis",
      "name": "Financial Analysis",
      "description": "Analyze financial data and identify trends",
      "tags": ["finance", "analysis", "reporting"],
      "examples": ["Analyze Q3 revenue trends", "Compare YoY performance"]
    }
  ]
}
```

---

## Appendix B: Example Workflow

```json
{
  "intent": "Analyze news article and generate report",
  "nodes": {
    "fetch": {
      "capabilityId": "cap.http.fetch.v1",
      "payload": {
        "url": "https://example.com/article"
      }
    },
    "extract": {
      "capabilityId": "cap.text.extract.v1",
      "dependsOn": ["fetch"],
      "inputMappings": {
        "html": "$.fetch.result.body"
      }
    },
    "summarize": {
      "capabilityId": "cap.text.summarize.v1",
      "dependsOn": ["extract"],
      "inputMappings": {
        "text": "$.extract.result.text"
      },
      "requiresVerification": true
    },
    "sentiment": {
      "capabilityId": "cap.text.sentiment.v1",
      "dependsOn": ["extract"],
      "inputMappings": {
        "text": "$.extract.result.text"
      }
    },
    "report": {
      "capabilityId": "cap.text.generate.v1",
      "dependsOn": ["summarize", "sentiment"],
      "inputMappings": {
        "summary": "$.summarize.result.summary",
        "sentiment": "$.sentiment.result.label"
      }
    }
  },
  "settings": {
    "maxRuntimeMs": 300000,
    "maxBudgetCredits": 100
  }
}
```

---

## Changelog

### v0.1.0 (2024-12-04)
- Initial draft
- A2A v0.3.0 compatibility
- Identity trinity definition
- Profile system (0-6)
- Economic primitives
- Error taxonomy
