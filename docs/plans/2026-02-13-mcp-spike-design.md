# MCP Stdio Spike (Sprint 23) Design

Date: 2026-02-13

Owner: Platform

Tickets: `STLD-T2305`, `STLD-T2306`

## Goal

Prove that an MCP-compatible agent can reliably discover and invoke a *curated* set of Nooterra tools over `stdio`, using a **restricted API key** (not an ops token).

This is a spike: correctness and minimal compatibility matter more than feature breadth. Production hardening (SSE transport, rate limiting, etc.) is explicitly deferred to Sprint 25.

## Non-Goals (S23)

- No SSE transport.
- No multi-tenant discovery. Tenant is configured via env.
- No generic “HTTP proxy tool”. We expose curated tools only.
- No persistence inside the MCP server. It is a stateless bridge to the Nooterra API.

## Transport + Protocol

- Transport: `stdio`
- Protocol: JSON-RPC 2.0 message stream.
- Framing: newline-delimited JSON; additionally accepts `Content-Length:` framed messages for compatibility.
- Required methods:
  - `initialize`
  - `tools/list`
  - `tools/call`
- Optional methods (implemented as no-ops / trivial):
  - `ping`
  - `notifications/initialized` (ignored)

## Auth Model

- The MCP server requires `NOOTERRA_API_KEY` and uses `x-proxy-api-key` for all API calls.
- The API key must have the minimum scopes needed for:
  - registering agents
  - marketplace RFQ/bid/accept
  - wallet credit (requires `x-nooterra-protocol` header)
  - agent run event appends (requires `x-nooterra-protocol` + `x-proxy-expected-prev-chain-hash`)
  - run dispute transitions (requires `x-nooterra-protocol`)

No ops token handling is included in the spike.

## Configuration

Environment variables:

- `NOOTERRA_BASE_URL` (default: `http://127.0.0.1:3000`)
- `NOOTERRA_TENANT_ID` (default: `tenant_default`)
- `NOOTERRA_API_KEY` (required)
- `NOOTERRA_PROTOCOL` (optional; if unset the server attempts to discover via `GET /healthz` response header `x-nooterra-protocol`, falling back to `1.0`)

## Tool Surface (Curated)

### `nooterra.create_agreement`

Creates a real marketplace-backed agreement by executing:

1. `POST /agents/register` (payer)
2. `POST /agents/register` (payee)
3. `POST /agents/{payerAgentId}/wallet/credit` (fund payer)
4. `POST /marketplace/rfqs`
5. `POST /marketplace/rfqs/{rfqId}/bids`
6. `POST /marketplace/rfqs/{rfqId}/accept` (returns `runId`, agreement, settlement)

Returns IDs needed for subsequent tools: `payerAgentId`, `payeeAgentId`, `rfqId`, `bidId`, `runId`, `settlementId`, `agreementId`.

### `nooterra.submit_evidence`

Appends an agent run event:

- `GET /agents/{agentId}/runs/{runId}/events` to obtain current `prevChainHash`
- `POST /agents/{agentId}/runs/{runId}/events` with `type=EVIDENCE_ADDED` and `x-proxy-expected-prev-chain-hash`

### `nooterra.settle_run`

Moves a run to terminal state (which triggers auto-resolution in the Nooterra API):

- `GET /agents/{agentId}/runs/{runId}/events` (prevChainHash)
- `POST /agents/{agentId}/runs/{runId}/events` with `type=RUN_COMPLETED` (or `RUN_FAILED`)

### `nooterra.open_dispute`

Opens a dispute for a resolved run settlement:

- `POST /runs/{runId}/dispute/open`

## Error Handling

- API errors are surfaced as tool results with `isError=true` and a text payload containing `{ statusCode, message, details }` when available.
- JSON-RPC protocol errors use standard JSON-RPC error responses.

## Latency Measurement

Each tool call returns `durationMs` measured inside the MCP process (wall-clock). This measures bridge overhead + API time; it is sufficient for spike validation and can be compared against direct API calls later.

## Testing

- A `node --test` smoke test exercises:
  - `initialize`
  - `tools/list` (tool names + schemas)
  - one `tools/call` against a local stub HTTP server (no secrets required)

## Roll Forward Path (S25)

- Add SSE transport.
- Add richer auth modes (service tokens, per-tool scopes, per-tenant selection).
- Add stronger redaction of tool outputs.
- Add structured telemetry and rate limiting.

