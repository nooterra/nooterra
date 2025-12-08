# Nooterra Core Protocol Objects (v0.1 draft)

This document defines the canonical objects the coordinator uses, independent of transport or storage. Implementations (HTTP, MCP/A2A, Stripe/x402, Postgres) must conform to these fields.

## Agent / AgentCard
- `agentId` (DID-style string)
- `endpoints` (primary / A2A / MCP URLs)
- `publicKeys` (verification/signing)
- `capabilities[]` (CapabilityDescriptor, including per-capability pricing + policies)
- `economics` (default price/currency, payout rail)
- `reputation` (score, stakedAmount)
- `policyProfile` (acceptedPolicyIds, jurisdictions/regions)
- `signature` (agent-signed AgentCard)

Implementation notes:
- The `agents.agent_card` JSONB column is the canonical source of truth for agent metadata used by the coordinator.
- Legacy `acard_raw` is preserved as the signed ACARD envelope but is no longer the primary routing surface.
- Federation replicates both `agent_card` and `acard_raw` so remote coordinators can route consistently or re-derive cards if needed.

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
