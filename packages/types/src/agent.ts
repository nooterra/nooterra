/**
 * @nooterra/types - Agent Types
 *
 * Type definitions for agents, ACARDs, and agent runtime.
 */

/**
 * Agent Card (ACARD) - The identity document for an agent
 */
export interface AgentCard {
  /** Decentralized identifier (e.g., "did:noot:my-agent") */
  did: string;
  /** Public endpoint URL */
  endpoint: string;
  /** Ed25519 public key (base64 encoded) */
  publicKey: string;
  /** ACARD version number */
  version: number;
  /** Optional lineage/previous DID */
  lineage?: string | null;
  /** Agent's capabilities */
  capabilities: AgentCapability[];
  /** Optional metadata */
  metadata?: {
    name?: string;
    description?: string;
    author?: string;
    homepage?: string;
    [key: string]: unknown;
  };
  /**
   * Supported profiles (NIP-0001 Section 7)
   * Advertises compliance levels and optional certification
   */
  profiles?: ProfileDeclaration[];
  /**
   * Economic configuration (required for Profile 2+)
   */
  economics?: EconomicsConfig;
  /** Supported A2A protocol version */
  a2aVersion?: string;
  /** Optional human-friendly name */
  name?: string;
  /** Optional description */
  description?: string;
  /** Streaming support flag */
  supportsStreaming?: boolean;
  /** Push/Webhook support flag */
  supportsPushNotifications?: boolean;
  /** Signature over the ACARD (base64 encoded) */
  signature?: string;
}

/**
 * Capability definition within an ACARD
 */
export interface AgentCapability {
  /** Capability ID (e.g., "cap.text.summarize.v1") */
  id: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for inputs */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema for outputs */
  outputSchema?: Record<string, unknown>;
  /** Price in NCR cents (1 cent = $0.01) */
  pricingCents?: number;
  /** Price in credits (1 credit = 0.001 USD) */
  priceCredits?: number;
  /** Optional tags for discovery */
  tags?: string[];
  /** Embedding dimension (auto-filled by registry) */
  embeddingDim?: number;
}

/**
 * Profile declaration indicating compliance level (NIP-0001)
 */
export interface ProfileDeclaration {
  profile: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  version: string;
  certified?: boolean;
  certificationUrl?: string;
}

/**
 * Economic configuration for the agent
 */
export interface EconomicsConfig {
  acceptsEscrow: boolean;
  minBidCents?: number;
  maxBidCents?: number;
  supportedCurrencies?: string[];
  settlementMethods?: ("instant" | "batched" | "l2")[];
}

// Receipt claims (NIP-0002)
export interface ReceiptClaims {
  rid: string;
  rtype: "task" | "workflow" | "settlement" | "attestation";
  iat: number;
  iss: string; // agent DID
  sub: string; // task/workflow ID
  rh: string; // result hash (base64url)
  prid?: string;
  wid?: string;
  node?: string;
  cap?: string;
  credits?: number;
  escrow?: string;
  stx?: string;
  ih?: string;
  dur?: number;
  coord?: string;
  ciat?: number;
  profile?: number;
  qscore?: number;
  ext?: Record<string, unknown>;
}

/**
 * Agent registration data (stored in registry)
 */
export interface Agent {
  /** Unique database ID */
  id: string;
  /** Decentralized identifier */
  did: string;
  /** Human-readable name */
  name?: string;
  /** Public endpoint */
  endpoint: string;
  /** Ed25519 public key */
  publicKey: string;
  /** Wallet address for payments */
  walletAddress?: string;
  /** Current reputation score [0, 1] */
  reputation: number;
  /** Whether agent is currently available */
  isAvailable: boolean;
  /** Last heartbeat timestamp */
  lastHeartbeat?: Date;
  /** Registration timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Agent statistics
 */
export interface AgentStats {
  /** Agent DID */
  agentDid: string;
  /** Total successful tasks */
  tasksSuccess: number;
  /** Total failed tasks */
  tasksFailed: number;
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Last updated timestamp */
  lastUpdatedAt: Date;
}

/**
 * Agent health metrics (sliding window)
 */
export interface AgentHealth {
  /** Agent DID */
  agentDid: string;
  /** Window start time */
  windowStart: Date;
  /** Window end time */
  windowEnd: Date;
  /** Total calls in window */
  callCount: number;
  /** Successful calls */
  successCount: number;
  /** Timed out calls */
  timeoutCount: number;
  /** Average latency in window */
  avgLatencyMs: number;
  /** Computed health score [0, 1] */
  healthScore: number;
  /** Last error type encountered */
  lastErrorType?: string;
}

/**
 * Handler context passed to agent capability handlers
 */
export interface HandlerContext {
  /** Workflow ID */
  workflowId: string;
  /** Task/dispatch ID */
  taskId: string;
  /** Node name in workflow */
  nodeId: string;
  /** Capability being invoked */
  capabilityId: string;
  /** Input payload */
  inputs: unknown;
  /** Outputs from parent nodes */
  parents: Record<string, unknown>;
  /** Additional metadata */
  meta: Record<string, unknown>;
}

/**
 * Handler result returned by agent capability handlers
 */
export interface HandlerResult {
  /** The result payload */
  result: unknown;
  /** Optional execution metrics */
  metrics?: {
    latencyMs?: number;
    [key: string]: unknown;
  };
}

/**
 * Agent lifecycle hooks
 */
export interface AgentHooks {
  /** Called when a task is dispatched to the agent */
  onDispatch?: (event: {
    workflowId: string;
    nodeId: string;
    capabilityId: string;
    payload: unknown;
  }) => void;
  /** Called when a task completes */
  onResult?: (event: {
    workflowId: string;
    nodeId: string;
    capabilityId: string;
    payload: unknown;
    result: unknown;
    metrics?: unknown;
  }) => void;
  /** Called on error */
  onError?: (event: {
    workflowId?: string;
    nodeId?: string;
    capabilityId?: string;
    payload?: unknown;
    error: unknown;
  }) => void;
  /** Called on heartbeat */
  onHeartbeat?: (event: { ok: boolean; error?: unknown }) => void;
}

/**
 * Agent SDK configuration
 */
export interface AgentConfig {
  /** Agent DID */
  did: string;
  /** Registry URL */
  registryUrl: string;
  /** Coordinator URL */
  coordinatorUrl: string;
  /** Webhook secret for signature verification */
  webhookSecret: string;
  /** Ed25519 public key (base64 or base58) */
  publicKey?: string;
  /** Ed25519 private key (base64 or base58) */
  privateKey?: string;
  /** Public endpoint URL */
  endpoint: string;
  /** Port to listen on */
  port?: number;
  /** Capability definitions */
  capabilities: Array<{
    id: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    priceCredits?: number;
    handler: (ctx: HandlerContext) => Promise<HandlerResult>;
  }>;
  /** Lifecycle hooks */
  hooks?: AgentHooks;
}
