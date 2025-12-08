# Nooterra Core Protocol Objects (v0.1 draft)

This document defines the canonical objects the coordinator uses, independent of transport or storage. Implementations (HTTP, MCP/A2A, Stripe/x402, Postgres) must conform to these fields.

## Agent / AgentCard
- `agentId` (DID-style string)
- `endpoints[]` (URL, transport)
- `publicKeys[]` (verification/signing)
- `capabilities[]` (CapabilityDescriptor)
- `regions[]` (optional)
- `complianceClaims` (optional)
- `signature` (agent-signed AgentCard)

## CapabilityDescriptor
- `capabilityId` (string, versioned)
- `inputSchema` / `outputSchema` (JSON schema)
- `price` (unit pricing model)
- `policyRequirements` (policy IDs)
- `region` / `hardware` / `tee` (optional)

## Invocation
- `capabilityId`
- `input`
- `budget` (max price/credits)
- `policies` (policy IDs to honor)
- `traceId` / `correlationId`
- `meta` (freeform)

## Mandate (authority & spend)
- `issuer` (user/org DID)
- `subject` (agentId authorized)
- `capabilityScope` (capability ids)
- `budgetCap` (max spend)
- `policyIds`
- `expiry`
- `nonce` / `idempotencyKey`
- `signature` (issuer-signed)

## Receipt
- `workflowId`
- `nodeId`
- `agentDid`
- `capabilityId`
- `inputHash`
- `outputHash`
- `creditsCharged`
- `durationMs`
- `traceId`
- `profile` (eval profile / quality level)
- `signature` (agent; coordinator co-sign optional)

## Ledger
- `LedgerAccount`: `ownerDid`, `balance`, `currency`
- `LedgerEvent`: `ownerDid`, `amount`, `currency`, `eventType`, `workflowId?`, `nodeName?`, `traceId?`, `description/meta`
- `Escrow`: `accountDid`, `workflowId/nodeName`, `amount`, `status`

## Policy
- `policyId`
- `rules` (data residency, PII, forbidden capabilities, regions, retention, etc.)
- Binding points: Mandate (requested), AgentCard (accepted), Receipt (executed under)

## Trace
- `traceId` (single ID per workflow/request)
- Propagates through: workflows, task_nodes, dispatch_queue, receipts, ledger_events.

## PaymentRail (abstraction)
- `createTopUpIntent`, `verifyWebhook`, `applyWebhookEvent`, `reconcile`
- Rails: Stripe today; x402 or others later.
