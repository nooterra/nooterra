# Reference Workflow Demo (Nooterra Machine-Economy Spine)

This example defines a small but complete network of agents and a DAG
workflow that exercises the core protocol objects:

- AgentCard → AgentRoutingProfile
- Mandate → Invocation.constraints → routing filters
- Invocation → envelopes → receipts → ledger
- Verifier → verification_score → reputation

It is the canonical “show me everything working” demo.

> Status: design spec – agents and scripts should be implemented to match
> this document.

---

## 1. Reference Agents & Capabilities

We use four logical agents. In practice they can be separate processes or
co-located, but each has its own DID and AgentCard.

### 1.1 HTTP Fetch Agent

- **DID**: `did:noot:agent:fetch-http`
- **Capability**: `cap.fetch.http.v1`
- **Purpose**: Fetch JSON or text from a public HTTP endpoint.
- **Input** (JSON):

  ```json
  {
    "url": "https://example.com/api",
    "method": "GET",
    "headers": {
      "Accept": "application/json"
    },
    "body": null
  }
  ```

- **Output**:

  ```json
  {
    "status": 200,
    "headers": { "content-type": "application/json" },
    "body": "{ ... raw string body ... }"
  }
  ```

- **AgentCard notes**:
  - `endpoints.primaryUrl`: public URL of the agent server.
  - `capabilities`: includes `cap.fetch.http.v1` with appropriate schemas.
  - `economics.defaultPriceCents`: small fixed price, e.g. 1–2 cents.
  - `policyProfile`:
    - `acceptedPolicyIds`: e.g. `["policy.http.public-only"]`
    - `jurisdictions`: e.g. `["us-west"]`

### 1.2 Summarizer Agent

- **DID**: `did:noot:agent:summarize`
- **Capability**: `cap.text.summarize.v1`
- **Purpose**: Summarize arbitrary text using an LLM rail.
- **Input**:

  ```json
  {
    "text": "long text to summarize",
    "style": "short"
  }
  ```

- **Output**:

  ```json
  {
    "summary": "short summary of the text"
  }
  ```

- **AgentCard notes**:
  - Uses an LLM adapter (OpenAI/HF) behind the scenes.
  - `economics.defaultPriceCents`: higher than fetch, e.g. 5–10 cents.
  - `policyProfile`:
    - `acceptedPolicyIds`: `["policy.demo.strict"]`
    - `jurisdictions`: e.g. `["us-west"]`

### 1.3 Verifier Agent (Mandate + Envelope Compliance)

- **DID**: `did:noot:agent:verify-mandate`
- **Capability**: `cap.verify.mandate.envelope.v1`
- **Purpose**: Check that an invocation and its receipts are compliant with:
  - the Mandate (policyIds / regions),
  - the AgentCard routing constraints,
  - result envelope signature validity.
- **Input**:

  ```json
  {
    "invocationId": "UUID"
  }
  ```

- **Output** (mirrors `/internal/verify/invocation/:id`):

  ```json
  {
    "invocationId": "UUID",
    "workflowId": "UUID",
    "traceId": "trace-123",
    "compliant": true,
    "issues": [],
    "updatedAgents": ["did:noot:agent:summarize"]
  }
  ```

- **Implementation sketch**:
  - Reads `invocationId` from input.
  - Calls coordinator internal API:

    - `GET /internal/verify/invocation/:id`

  - Returns the JSON payload as its result.

- **AgentCard notes**:
  - `capabilities` includes `cap.verify.mandate.envelope.v1`.
  - `supportsVerification` will be `true` via routing profile.

### 1.4 (Optional) Reporter Agent

- **DID**: `did:noot:agent:report`
- **Capability**: `cap.analytics.report.v1`
- **Purpose**: Produce a human-readable report for a trace.
- **Input**:

  ```json
  {
    "traceId": "trace-123"
  }
  ```

- **Output**:

  ```json
  {
    "report": "Workflow wf-1, nodes: fetch_data → summarize → verify; compliant=true; summary=..."
  }
  ```

---

## 2. Reference Mandate

The reference workflow should run under a simple Mandate that demonstrates
policy + region + budget constraints:

```json
{
  "payerDid": "did:noot:user:demo",
  "budgetCapCents": 500,
  "maxPriceCents": 100,
  "policyIds": ["policy.demo.strict"],
  "regionsAllow": ["us-west"],
  "regionsDeny": [],
  "notBefore": null,
  "notAfter": null
}
```

This is attached to the workflow via:

- `POST /v1/workflows/:id/mandate`

The coordinator then:

- stores `mandate_id` and policy/region arrays on `workflows`,
- propagates `policyIds` / `regionsAllow` / `regionsDeny` into
  `Invocation.constraints`,
- stores `mandate_id` on `invocations` and `task_receipts`.

Routing uses these fields to exclude agents whose `AgentRoutingProfile` does
not accept the required policies or regions.

---

## 3. Reference Workflow DAG

The DAG is expressed as a workflow manifest, e.g.
`examples/reference-workflow/workflow.json`:

```json
{
  "name": "reference-demo",
  "description": "Fetch → Summarize → Verify (Mandate + Envelope)",
  "nodes": {
    "fetch_data": {
      "capabilityId": "cap.fetch.http.v1",
      "payload": {
        "url": "https://example.com",
        "method": "GET"
      }
    },
    "summarize": {
      "capabilityId": "cap.text.summarize.v1",
      "dependsOn": ["fetch_data"],
      "payload": {
        "textFrom": "fetch_data.body",
        "style": "short"
      }
    },
    "verify": {
      "capabilityId": "cap.verify.mandate.envelope.v1",
      "dependsOn": ["summarize"],
      "payload": {
        "invocationIdFrom": "summarize.invocationId"
      }
    }
  }
}
```

The “From” fields (`textFrom`, `invocationIdFrom`) are illustrative; the
actual implementation should map parent outputs and invocationIds into
the child node payload as appropriate.

---

## 4. Demo Flow (Scripts to Implement)

The intended end‑to‑end flow:

1. **Register reference agents**

   - Script: `scripts/register-reference-agents.ts`
   - Responsibilities:
     - Build `NooterraAgentCard` objects for the four agents.
     - Register them with the registry / coordinator.
     - Ensure capabilities are visible to the types/registry.

2. **Publish workflow + attach mandate**

   - Script: `examples/reference-workflow/run.ts`
   - Responsibilities:
     - POST `/v1/workflows/publish` with the DAG manifest.
     - POST `/v1/workflows/:id/mandate` with the reference Mandate JSON.
     - Trigger execution and poll for completion.
     - Print:
       - `workflowId`
       - `traceId`
       - final status.

3. **Inspect trace**

   - Script: `examples/reference-workflow/inspect.ts`
   - Responsibilities:
     - Given `traceId`, call `/internal/trace/:traceId`.
     - Print a concise summary:
       - nodes, their agents and capabilities,
       - `mandateId`, policyIds, regions,
       - `envelope_signature_valid` per node,
       - verifier result (compliant / issues).

---

## 5. Expected Behavior

For a healthy run:

- All nodes complete with status `success`.
- The Mandate policy/region constraints:
  - allow the selected agents (profiles overlap on policyIds and regions).
- Result envelopes for agents that sign their outputs:
  - have `envelope_signature_valid = true`.
- `/internal/verify/invocation/:id` returns:
  - `compliant: true`
  - `issues: []`
  - `updatedAgents` containing the DIDs of participating agents.
- `agent_reputation.verification_score` for those agents is nudged toward 1
  by the internal verification hook.

Traces for misconfigured agents (wrong regions, wrong policies, invalid
signatures) should show:

- mandate filter drops in routing,
- verifier `compliant = false` and issue codes such as:
  - `policy_mismatch`
  - `region_not_allowed`
  - `signature_invalid`.

This reference workflow is the canonical demonstration that the Nooterra
coordination node is not just a workflow engine, but a protocol-driven
machine economy kernel. It should be kept in sync with any major protocol
changes (AgentCard, Mandate, Invocation, Envelope, Receipt, Reputation).

