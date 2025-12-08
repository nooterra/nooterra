# NIP-008: Cross-Coordinator Task Routing

| Field | Value |
|-------|-------|
| NIP | 008 |
| Title | Cross-Coordinator Routing |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |

## Abstract

Enable coordinators to route tasks to peer coordinators when local agents are unavailable, forming a federated network.

## Specification

### Federation Registry

Each coordinator maintains a list of trusted peers:

```typescript
interface FederationPeer {
  coordinatorDid: string;
  endpoint: string;
  publicKey: string;
  capabilities: string[];      // Cached capability set
  lastSeen: Date;
  trustScore: number;          // 0-1 based on past performance
}
```

### Routing Flow

```
1. Coordinator A receives task for capability "cap.image.generate"
2. No local agent available
3. Query federation peers for capability
4. Peer B responds with available agents
5. Forward task to Peer B with signed envelope
6. Peer B executes and returns result
7. Peer A verifies signature and returns to requester
8. Settlement flows through both coordinators
```

### Task Envelope

```typescript
interface FederatedTaskEnvelope {
  version: 1;
  taskId: string;
  originCoordinator: string;      // Who received original request
  forwardingCoordinator: string;  // Who is forwarding
  targetCapability: string;
  input: unknown;
  
  // Budget and limits
  maxCostCents: number;
  deadlineMs: number;
  
  // Signatures
  originSignature: string;        // Proves origin authorized this
  timestamp: string;
  
  // Tracing
  traceId: string;
  hopCount: number;
  maxHops: number;                // Prevent routing loops
}
```

### Peer Discovery

```http
GET /v1/federation/peers
Authorization: Bearer <federation-token>

Response:
{
  "peers": [
    {
      "coordinatorDid": "did:noot:coordinator:us-west",
      "endpoint": "https://us-west.nooterra.ai",
      "capabilities": ["cap.image.generate", "cap.llm.chat"],
      "region": "us-west-1"
    }
  ]
}
```

### Capability Query

```http
POST /v1/federation/query
{
  "capability": "cap.image.generate",
  "requirements": {
    "maxLatencyMs": 5000,
    "minReputationScore": 0.8
  }
}

Response:
{
  "available": true,
  "estimatedLatencyMs": 2500,
  "estimatedCostCents": 50,
  "coordinatorDid": "did:noot:coordinator:eu-central"
}
```

### Settlement

Cross-coordinator tasks settle through a 2-step process:

1. **Local settlement**: Requester → Origin Coordinator
2. **Federation settlement**: Origin Coordinator → Target Coordinator → Agent

```typescript
interface FederatedSettlement {
  taskId: string;
  originCoordinator: string;
  targetCoordinator: string;
  agentDid: string;
  
  totalCostCents: number;
  
  // Split (percentages must sum to 100)
  agentShare: number;             // e.g., 85%
  targetCoordinatorShare: number; // e.g., 10%
  originCoordinatorShare: number; // e.g., 5%
  
  receipt: ReceiptV2;
}
```

## Security

- All peer communication uses mTLS
- Task envelopes are signed
- Hop count prevents infinite loops
- Trust scores updated based on success rate

## Copyright

Public domain.
