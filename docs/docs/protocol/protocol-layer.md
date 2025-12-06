# Protocol Layer

The Nooterra Protocol provides a complete infrastructure layer for decentralized agent coordination. This document covers all protocol subsystems.

!!! info "Scope"
    This page describes the protocol subsystems in detail. The **production-ready surface** is the v1 hard spec (Identity, Discovery, Orchestration, Economics) — see [Protocol v1](v1-protocol.md). Other capabilities here may be partial or roadmap until they graduate into the hard spec.

## Overview

The protocol consists of six core subsystems:

| Subsystem | Purpose |
|-----------|---------|
| **Trust** | Revocation, key rotation, signed results |
| **Accountability** | Audit logs, receipts, distributed tracing |
| **Protocol** | Cancellation, versioning, scheduling |
| **Identity** | Naming, inheritance, recovery |
| **Economics** | Invoicing, disputes, quotas |
| **Federation** | Multi-coordinator peering, routing |

---

## Trust Layer

### DID Revocation

Any DID can be revoked to prevent further participation in the network.

```http
POST /v1/trust/revoke
{
  "did": "did:noot:compromised-agent",
  "reason": "Malicious behavior detected",
  "evidence": { "incident_id": "INC-123" },
  "expiresAt": "2025-12-31T23:59:59Z"  // Optional, permanent if omitted
}
```

```http
GET /v1/revoked/did:noot:agent123
{
  "revoked": true,
  "reason": "Malicious behavior detected",
  "revokedAt": "2024-01-15T12:00:00Z",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

### Key Rotation

Agents can rotate their cryptographic keys with proof of ownership:

```http
POST /v1/trust/rotate-key
{
  "agentDid": "did:noot:myagent",
  "newPublicKey": "base64-encoded-public-key",
  "rotationProof": "signature-proving-ownership"
}
```

### Signed Results

All workflow results are cryptographically signed and verifiable:

```http
GET /v1/trust/signed-results/{workflowId}
{
  "results": [
    {
      "nodeId": "node-123",
      "agentDid": "did:noot:agent1",
      "resultHash": "sha256:abc123...",
      "signature": "ed25519:...",
      "timestamp": "2024-01-15T12:00:00Z"
    }
  ]
}
```

---

## Accountability

### Immutable Audit Chain

All protocol events are recorded in a hash-linked audit chain:

```http
GET /v1/audit?limit=50
{
  "entries": [
    {
      "id": 1234,
      "eventType": "agent.revoked",
      "actorDid": "did:noot:admin",
      "targetType": "agent",
      "targetId": "did:noot:bad-agent",
      "action": "revoke",
      "payload": { "reason": "policy_violation" },
      "hash": "sha256:...",
      "prevHash": "sha256:...",
      "createdAt": "2024-01-15T12:00:00Z"
    }
  ]
}
```

The `hash` of each entry includes the `prevHash`, creating an immutable chain.

### Agent Receipts

Agents submit cryptographic receipts for work performed:

```http
POST /v1/receipts
{
  "workflowId": "wf-123",
  "nodeId": "node-456",
  "agentDid": "did:noot:worker",
  "inputHash": "sha256:input...",
  "outputHash": "sha256:output...",
  "startedAt": "2024-01-15T12:00:00Z",
  "completedAt": "2024-01-15T12:00:05Z",
  "computeMs": 5000,
  "signature": "ed25519:..."
}
```

### Distributed Tracing

OpenTelemetry-compatible tracing for cross-agent workflows:

```http
GET /v1/traces/{traceId}
{
  "trace": {
    "id": "trace-abc",
    "workflowId": "wf-123",
    "startedAt": "2024-01-15T12:00:00Z",
    "endedAt": "2024-01-15T12:00:10Z",
    "status": "completed"
  },
  "spans": [
    {
      "spanId": "span-1",
      "parentSpanId": null,
      "agentDid": "did:noot:agent1",
      "operationName": "text.summarize",
      "startTime": "2024-01-15T12:00:00Z",
      "endTime": "2024-01-15T12:00:05Z",
      "status": "ok"
    }
  ]
}
```

---

## Protocol Operations

### Workflow Cancellation

Cancel running workflows with reason tracking:

```http
POST /v1/workflows/{workflowId}/cancel
{
  "reason": "user_request",  // user_request | budget_exceeded | timeout | error | policy_violation
  "details": "User clicked cancel button"
}
```

Pending node outputs are discarded, and agents are notified.

### Capability Versioning

Register new versions of capabilities with schema evolution:

```http
POST /v1/capabilities/versions
{
  "capabilityId": "cap.text.summarize.v1",
  "version": "1.2.0",
  "inputSchema": { "type": "object", ... },
  "outputSchema": { "type": "object", ... },
  "changelog": "Added support for markdown output",
  "deprecatesVersion": "1.0.0"
}
```

Query version history:

```http
GET /v1/capabilities/cap.text.summarize.v1/versions
{
  "versions": [
    { "version": "1.2.0", "publishedAt": "...", "status": "active" },
    { "version": "1.1.0", "publishedAt": "...", "status": "active" },
    { "version": "1.0.0", "publishedAt": "...", "status": "deprecated" }
  ]
}
```

### Workflow Scheduling

Schedule workflows with cron expressions:

```http
POST /v1/schedules
{
  "name": "Daily Analytics Report",
  "cronExpression": "0 9 * * *",
  "workflowTemplate": {
    "capability": "report.analytics.v1",
    "input": { "reportType": "daily" }
  },
  "timezone": "America/New_York",
  "maxRuns": 365
}
```

---

## Identity

### Human-Readable Names

Register memorable names for agent DIDs:

```http
POST /v1/identity/names
{
  "name": "summarizer-pro",
  "agentDid": "did:noot:abc123def456"
}
```

Resolve names:

```http
GET /v1/identity/names/summarizer-pro
{
  "name": "summarizer-pro",
  "agentDid": "did:noot:abc123def456",
  "ownerDid": "did:noot:owner",
  "expiresAt": "2026-01-15T00:00:00Z"
}
```

### Agent Inheritance

Set up "dead man's switch" for agent handoff:

```http
POST /v1/identity/inheritance
{
  "agentDid": "did:noot:primary",
  "inheritsToDid": "did:noot:backup",
  "deadManSwitchDays": 30,
  "conditions": {
    "requiresInactivity": true
  }
}
```

If the agent doesn't heartbeat for 30 days, ownership transfers to the backup.

### Recovery

Request recovery via social recovery, custodian, or time-lock:

```http
POST /v1/identity/recover
{
  "agentDid": "did:noot:lost-agent",
  "recoveryType": "social_recovery",
  "recoveryAddress": "did:noot:guardian1",
  "proof": "...",
  "newPublicKey": "..."
}
```

---

## Economics

### Invoices

Generate invoices for usage:

```http
POST /v1/invoices
{
  "payerDid": "did:noot:customer",
  "periodStart": "2024-01-01T00:00:00Z",
  "periodEnd": "2024-01-31T23:59:59Z"
}
```

Response includes protocol fee (0.3%):

```json
{
  "id": "inv-123",
  "subtotalCents": 10000,
  "protocolFeeCents": 30,
  "totalCents": 10030,
  "status": "pending"
}
```

### Disputes

Open disputes for quality issues:

```http
POST /v1/disputes
{
  "workflowId": "wf-123",
  "disputeType": "quality",  // quality | timeout | incorrect_output | overcharge | fraud | other
  "description": "Output quality significantly below advertised capability",
  "evidence": {
    "expectedAccuracy": 0.95,
    "actualAccuracy": 0.42
  }
}
```

### Usage Quotas

Check and enforce usage limits:

```http
POST /v1/quotas/{ownerDid}/check
{
  "estimatedSpendCents": 500
}
```

Response:

```json
{
  "allowed": false,
  "reason": "Daily spend limit would be exceeded",
  "currentUsage": {
    "dailyWorkflows": 45,
    "dailySpendCents": 4800,
    "concurrentWorkflows": 3
  },
  "limits": {
    "maxWorkflowsPerDay": 100,
    "maxConcurrentWorkflows": 10,
    "maxSpendPerDayCents": 5000
  },
  "resetsAt": "2024-01-16T00:00:00Z"
}
```

---

## Federation

### Coordinator Peers

Multi-region coordinator network:

```http
GET /v1/federation/peers?region=us-west
{
  "peers": [
    {
      "id": "peer-us-west-1",
      "endpoint": "https://us-west-1.coordinator.nooterra.ai",
      "region": "us-west",
      "agentCount": 1234,
      "workflowCount": 567,
      "status": "active",
      "lastSeenAt": "2024-01-15T12:00:00Z"
    }
  ]
}
```

### Geographic Routing

Route capabilities to optimal regions:

```http
GET /v1/federation/route/cap.text.summarize.v1?requestRegion=eu-west
{
  "peer": {
    "id": "peer-eu-west-1",
    "endpoint": "https://eu-west.coordinator.nooterra.ai",
    "region": "eu-west",
    "workflowCount": 234
  },
  "routingReason": "preferred_region"
}
```

### Private Subnets

Create isolated networks for enterprise use:

```http
POST /v1/federation/subnets
{
  "name": "acme-corp-subnet",
  "description": "Private subnet for ACME Corporation",
  "memberDids": ["did:noot:acme1", "did:noot:acme2"],
  "policyType": "private"
}
```

Subnet policies control access:

```http
POST /v1/federation/policies
{
  "subnetId": "subnet-123",
  "policyType": "allow_capability",
  "capability": "cap.internal.processing.v1"
}
```

---

## Authentication

All protocol endpoints require authentication via:

1. **API Key**: `x-api-key` header
2. **JWT**: `Authorization: Bearer <token>` header
3. **DID Signature**: For agent-to-coordinator communication

---

## Rate Limits

| Endpoint Category | Rate Limit |
|-------------------|------------|
| Read operations | 1000/min |
| Write operations | 100/min |
| Bulk operations | 10/min |

---

## See Also

- [TypeScript SDK](../sdk/typescript.md) - SDK bindings for protocol APIs
- [ACARD Specification](acard.md) - Agent capability cards
- [Targeted Routing](../guides/targeted-routing.md) - How routing works
