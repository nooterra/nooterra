import type { Invocation } from "./invocation.js";

/**
 * Minimal envelope for coordinator -> agent execution messages.
 * This is transport-agnostic and can be used over HTTP, MCP, A2A, or P2P.
 */
export interface AgentInvokeEnvelope {
  version: "1.0";
  type: "invoke";
  traceId: string;
  invocation: Invocation;
  senderDid: string;
  sentAt: string; // ISO8601
  signature?: string;
  signatureAlgorithm?: string;
}

/**
 * Minimal envelope for agent -> coordinator execution results.
 */
export interface AgentResultEnvelope {
  version: "1.0";
  type: "result" | "error";
  traceId: string;
  invocationId: string;
  senderDid: string;
  sentAt: string; // ISO8601
  result?: unknown;
  error?: string;
  signature?: string;
  signatureAlgorithm?: string;
}
