# Mandate (Authority, Policy, and Budget Contract) v0.1

The `Mandate` is the contract that binds payer/org authority, policy and
region constraints, and budget limits to a set of invocations. It is the
object that tells the coordinator **what is allowed** for a workflow run.

Mandates are attached to workflows, propagated into `Invocation` constraints,
and recorded on receipts.

## Shape

TypeScript (from `@nooterra/types`):

```ts
export interface Mandate {
  mandateId: string;                // UUID
  payerDid: string;                 // user/org DID
  projectId?: string | null;

  budgetCapCents?: number | null;   // max total spend for workflow
  maxPriceCents?: number | null;    // optional max price per invocation

  policyIds?: string[];             // policies that MUST be honored
  regionsAllow?: string[];          // allowed regions (jurisdictions)
  regionsDeny?: string[];           // denied regions

  notBefore?: string | null;        // ISO8601
  notAfter?: string | null;         // ISO8601

  signature?: string;               // reserved for future VC / AP2 integration
  signatureAlgorithm?: string;
}
```

## Storage

Today the coordinator embeds mandate fields on `workflows` and links them to
invocations and receipts:

- `workflows.mandate_id`
- `workflows.mandate_policy_ids text[]`
- `workflows.mandate_regions_allow text[]`
- `workflows.mandate_regions_deny text[]`
- `invocations.mandate_id`
- `task_receipts.mandate_id`

The mandate **source of truth** is the workflow row; a dedicated `mandates`
table can be introduced later without changing the protocol shape.

## API

Mandates are attached/queried via the workflow API:

- `POST /v1/workflows/:id/mandate`
  - Accepts a `Mandate`-shaped payload (minus `mandateId`, which will be
    generated if omitted).
  - Validates `payerDid` consistency with the workflow's `payer_did`.
  - Writes:
    - `workflows.mandate_id`
    - `workflows.mandate_policy_ids`
    - `workflows.mandate_regions_allow`
    - `workflows.mandate_regions_deny`
    - updates `max_cents` (budget cap) when provided.

- `GET /v1/workflows/:id/mandate`
  - Returns the current mandate view for a workflow (or 404 if unset).

Once a mandate is attached, all new invocations from that workflow inherit its
policy and region constraints.

## Propagation into Invocation

When a DAG node is enqueued, the coordinator builds an `Invocation` using
`buildInvocation` (`apps/coordinator/src/services/invocation.ts`), which
includes mandate constraints:

- `Invocation.constraints.policyIds`
- `Invocation.constraints.regionsAllow`
- `Invocation.constraints.regionsDeny`

The `mandate_id` is stored in:

- `invocations.mandate_id`
- `task_receipts.mandate_id`

This gives a stable link between the mandate contract, the unit of work,
and the resulting receipts.

## Routing Enforcement

The router enforces mandate constraints by combining:

- `Invocation.constraints.policyIds` / `regionsAllow` / `regionsDeny`
- `AgentRoutingProfile.acceptedPolicyIds` / `regionsAllow`

The current v0 behavior:

- If `policyIds` is non-empty:
  - Any agent whose `acceptedPolicyIds` does not intersect `policyIds` is
    excluded from the candidate set.
- If `regionsAllow` is non-empty and the agent has non-empty `regionsAllow`:
  - Agents whose regions do not overlap `regionsAllow` are excluded.
- If `regionsDeny` is non-empty and the agent has non-empty `regionsAllow`:
  - Agents whose regions overlap `regionsDeny` are excluded.

These filters apply **before** scoring/selection and are logged as
mandate-related drops. This ensures that routing respects the mandate’s
policy and region constraints.

## Receipts & Verification

Receipts record the `mandate_id` and the result envelope validation status:

- `task_receipts.mandate_id`
- `task_receipts.envelope_signature_valid boolean`

The verifier service (`apps/coordinator/src/services/verifier.ts`) checks:

- `invocations.mandate_id` vs `task_receipts.mandate_id`
- mandate policy/region constraints vs `AgentRoutingProfile`
- `envelope_signature_valid`

via:

```ts
verifyInvocationCompliance(invocationId: string): Promise<{
  invocationId: string;
  workflowId: string;
  traceId: string;
  compliant: boolean;
  issues: { code: string; message: string; agentDid?: string; capabilityId?: string }[];
} | null>
```

An internal route:

- `GET /internal/verify/invocation/:id`

wraps this call and additionally updates `agent_reputation.verification_score`
for participating agents (see `reputation-verification.ts`).

## Future Work

- Treat Mandate as a signed VC (verifiable credential) aligned with AP2
  "Intent Mandate" semantics.
- Add a dedicated `mandates` table with full history/audit.
- Make external agents able to validate and require Mandate signatures before
  accepting work.

