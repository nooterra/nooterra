/**
 * Invocation types
 *
 * Canonical unit of work for capability execution.
 * This is a *protocol object*: it MUST be stable across
 * transports (HTTP, MCP, A2A, P2P) and implementors.
 */

export interface InvocationConstraints {
  /** Maximum wall-clock time for this invocation (ms) */
  timeoutMs?: number;
  /** Maximum price per call in cents */
  maxPriceCents?: number;
  /** Budget cap for this invocation in cents (workflow-level) */
  budgetCapCents?: number;
  /** Required policy IDs to honor */
  policyIds?: string[];
  /** Allowed regions for execution */
  regionsAllow?: string[];
  /** Explicitly denied regions */
  regionsDeny?: string[];
  /** Absolute deadline timestamp (ISO8601) */
  deadlineAt?: string;
}

export interface InvocationContext {
  /** Workflow ID this invocation belongs to */
  workflowId?: string;
  /** Node name inside the workflow DAG */
  nodeName?: string;
  /** Payer/owner DID funding this invocation */
  payerDid?: string;
  /** Project ID or tenant identifier */
  projectId?: string;
  /** Arbitrary tags or labels */
  tags?: string[];
}

export interface Invocation {
  /** Unique invocation ID (UUID) */
  invocationId: string;
  /** Trace ID for correlating across workflow/ledger/receipts */
  traceId: string;
  /** Capability ID to invoke (e.g., "cap.text.generate.v1") */
  capabilityId: string;
  /** Optional pre-selected agent DID (for targeted routing) */
  agentDid?: string;
  /** Optional mandate ID governing this invocation (if any) */
  mandateId?: string;
  /** Input payload for the capability */
  input: unknown;
  /** Execution constraints for this invocation */
  constraints?: InvocationConstraints;
  /** Execution context (workflow/node/payer/etc.) */
  context?: InvocationContext;
}
