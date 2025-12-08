/**
 * @nooterra/types - Federation Types
 *
 * Types for multi-coordinator, private subnets, and geographic routing.
 */

/**
 * Coordinator peer in federation
 */
export interface CoordinatorPeer {
  id: string;
  /** Peer's public endpoint */
  endpoint: string;
  /** Peer's public key for mTLS/signing */
  publicKey: string;
  /** Geographic region */
  region: string;
  /** Current health status */
  status: "online" | "offline" | "degraded";
  /** Last successful sync */
  lastSyncAt?: Date;
  /** Peer's known state version */
  stateVersion: number;
  /** Round-trip latency in ms */
  latencyMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Private subnet configuration
 */
export interface PrivateSubnet {
  id: string;
  name: string;
  /** Owner organization */
  ownerDid: string;
  /** Agents allowed in this subnet */
  allowedAgents: string[];
  /** Capabilities available in subnet */
  allowedCapabilities: string[];
  /** Whether to anchor state to public chain */
  anchorToChain: boolean;
  /** Chain ID for anchoring (if enabled) */
  chainId?: number;
  /** ZK proof of subnet state */
  latestProof?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Cross-subnet routing request
 */
export interface SubnetRoutingRequest {
  sourceSubnet?: string;
  targetSubnet?: string;
  capabilityId: string;
  requiresBridge: boolean;
}

/**
 * Geographic region definition
 */
export interface GeoRegion {
  id: string;
  name: string;
  code: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  timezone: string;
}

/**
 * Geographic routing preference
 */
export interface GeoRoutingPreference {
  preferredRegions?: string[];
  excludedRegions?: string[];
  maxLatencyMs?: number;
  requireSameRegion?: boolean;
}

/**
 * Federation gossip message
 */
export interface GossipMessage {
  type: GossipMessageType;
  sourceCoordinator: string;
  timestamp: number;
  payload: Record<string, unknown>;
  signature: string;
}

export type GossipMessageType =
  | "state_sync"
  | "agent_registered"
  | "agent_revoked"
  | "workflow_handoff"
  | "heartbeat"
  | "peer_discovery";

/**
 * Workflow handoff between coordinators
 */
export interface WorkflowHandoff {
  workflowId: string;
  fromCoordinator: string;
  toCoordinator: string;
  reason: string;
  stateSnapshot: Record<string, unknown>;
  handoffAt: Date;
}

/**
 * Federation status summary
 */
export interface FederationStatus {
  coordinatorId: string;
  region: string;
  peers: CoordinatorPeer[];
  subnets: PrivateSubnet[];
  stateVersion: number;
  lastGossipAt: Date;
  healthy: boolean;
}

/**
 * Coordinator-level invocation envelope for cross-coordinator execution.
 *
 * This is a thin wrapper around an Invocation plus mandate metadata,
 * signed by the origin coordinator when used in production.
 */
export interface CoordinatorInvokeEnvelope {
  version: "1.0";
  type: "coordinatorInvoke";
  /** Originating coordinator DID */
  originDid: string;
  /** Target coordinator DID */
  targetDid: string;
  /** Trace ID for correlation across nodes */
  traceId: string;
  /** Invocation to execute on the target coordinator */
  invocation: import("./invocation.js").Invocation;
  /** Optional mandate associated with this invocation */
  mandateId?: string | null;
  /** Optional signature over the envelope for authenticity */
  signature?: string;
  signatureAlgorithm?: string;
}

/**
 * Coordinator-level result envelope for returning execution results
 * back to the origin coordinator.
 */
export interface CoordinatorResultEnvelope {
  version: "1.0";
  type: "coordinatorResult";
  originDid: string;
  targetDid: string;
  traceId: string;
  /** Invocation ID this result corresponds to */
  invocationId: string;
  /** Agent-level result envelope produced by the target coordinator */
  resultEnvelope: import("./agent-envelope.js").AgentResultEnvelope;
  signature?: string;
  signatureAlgorithm?: string;
}
