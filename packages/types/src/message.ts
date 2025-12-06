/**
 * Message Types for Nooterra Protocol (NIP-0012)
 *
 * Defines the six canonical message types for agent coordination:
 * - TASK: Do work with commitment
 * - QUERY: Request information, no commitment
 * - PROPOSAL: Suggest a plan/contract
 * - ATTESTATION: Verifiable claim
 * - GRADIENT: Feedback signal for routing
 * - STATE: Blackboard/stigmergic update
 */

// ============================================================================
// Message Type Enum
// ============================================================================

/**
 * The six canonical message types for agent-to-agent communication.
 */
export enum MessageType {
  /** Do work with commitment - includes budget, deadline, escrow */
  TASK = "TASK",
  /** Request information or quote, no commitment */
  QUERY = "QUERY",
  /** Suggest a plan, contract, or workflow */
  PROPOSAL = "PROPOSAL",
  /** Verifiable claim about a subject */
  ATTESTATION = "ATTESTATION",
  /** Feedback signal for routing optimization */
  GRADIENT = "GRADIENT",
  /** Blackboard/stigmergic memory update */
  STATE = "STATE",
}

// ============================================================================
// Economic Envelope
// ============================================================================

/**
 * Economic metadata attached to every message.
 */
export interface EconomicEnvelope {
  /** Currency type for this message */
  currency: "NCR" | "EXTERNAL";
  /** Budget in NCR credits (for TASK messages) */
  budgetNcr?: number;
  /** Price per unit in NCR (for capability pricing) */
  pricePerUnitNcr?: number;
  /** Reference to external payment session (ACP/AP2/x402) */
  externalPaymentRef?: string;
  /** Escrow ID if funds are locked */
  escrowId?: string;
}

// ============================================================================
// Crypto Envelope
// ============================================================================

/**
 * Cryptographic metadata for message signing and verification.
 */
export interface CryptoEnvelope {
  /** Signature algorithm used */
  signatureType: "ed25519" | "hmac-sha256" | "none";
  /** Public key or DID of the signer */
  signer: string;
  /** Base64-encoded signature */
  signature: string;
  /** Reference to stored receipt (NIP-0002) */
  receiptRef?: string;
}

// ============================================================================
// Message Payloads
// ============================================================================

/**
 * Payload for TASK messages - work requests with commitment.
 */
export interface TaskPayload {
  /** Capability ID to invoke (e.g., "ml.text.generate") */
  capability: string;
  /** Input data for the capability */
  input: unknown;
  /** Optional constraints on execution */
  constraints?: TaskConstraints;
}

/**
 * Constraints for task execution.
 */
export interface TaskConstraints {
  /** Maximum time to wait for completion */
  timeoutMs?: number;
  /** Maximum price in NCR credits */
  maxPriceNcr?: number;
  /** Required geographic/logical region */
  region?: string;
  /** Minimum profile levels required (0-6) */
  requiredProfiles?: number[];
  /** Specific agent to route to */
  targetAgentId?: string;
  /** Whether to allow fallback if target unavailable */
  allowFallback?: boolean;
}

/**
 * Payload for QUERY messages - information requests without commitment.
 */
export interface QueryPayload {
  /** Capability to query about */
  capability: string;
  /** Query data (e.g., introspection request) */
  query: unknown;
}

/**
 * Payload for PROPOSAL messages - suggested plans or contracts.
 */
export interface ProposalPayload {
  /** ID of proposed workflow (if applicable) */
  proposedWorkflowId?: string;
  /** Array of tasks in the proposal */
  tasks?: TaskPayload[];
  /** Contract terms, SLAs, pricing */
  terms?: unknown;
  /** Expiration time for the proposal */
  expiresAt?: string;
}

/**
 * Payload for ATTESTATION messages - verifiable claims.
 */
export interface AttestationPayload {
  /** Subject of the attestation (workflow ID, result ID, etc.) */
  subject: string;
  /** Key-value claims being attested */
  claims: Record<string, unknown>;
  /** Reference to cryptographic proof */
  proofRef?: string;
  /** Hash of the attested content */
  contentHash?: string;
}

/**
 * Payload for GRADIENT messages - feedback for routing optimization.
 */
export interface GradientPayload {
  /** ID of the message this feedback is for */
  targetMessageId: string;
  /** Scalar reward signal (-1.0 to 1.0 typically) */
  reward: number;
  /** Detailed metrics about the execution */
  details?: GradientDetails;
}

/**
 * Detailed metrics for gradient feedback.
 */
export interface GradientDetails {
  /** Actual latency in milliseconds */
  latencyMs?: number;
  /** Whether the task succeeded */
  success?: boolean;
  /** Quality score (0-1) */
  qualityScore?: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Payload for STATE messages - stigmergic blackboard updates.
 */
export interface StatePayload {
  /** Blackboard namespace (e.g., "routing", "scheduling") */
  namespace: string;
  /** Capability this update relates to */
  capability: string;
  /** Hash of the problem context */
  contextHash: string;
  /** Delta values to apply (with decay) */
  delta: BlackboardDelta;
}

/**
 * Delta values for blackboard pheromone updates.
 */
export interface BlackboardDelta {
  /** Increment for success weight */
  successWeight?: number;
  /** Increment for failure weight */
  failureWeight?: number;
  /** Increment for congestion score */
  congestionScore?: number;
  /** Agent to add to preferred list */
  addPreferredAgent?: string;
  /** Agent to remove from preferred list */
  removePreferredAgent?: string;
}

/**
 * Union type for all message payloads.
 */
export type MessagePayload =
  | TaskPayload
  | QueryPayload
  | ProposalPayload
  | AttestationPayload
  | GradientPayload
  | StatePayload;

// ============================================================================
// Message Envelope
// ============================================================================

/**
 * Base message envelope - all messages carry this metadata.
 */
export interface NootMessageBase {
  /** Unique message ID (UUID) */
  id: string;
  /** Message type */
  type: MessageType;
  /** ISO8601 timestamp */
  timestamp: string;
  /** Sender agent DID */
  sender: string;
  /** Receiver agent DID (optional for broadcast) */
  receiver?: string;
  /** Correlation ID for tracing (workflow/request ID) */
  correlationId?: string;
  /** Profile level (0-6 per NIP-0001) */
  profileLevel: number;
  /** Constitution ID if ethics rules apply */
  constitutionId?: string;
  /** Economic metadata */
  economic: EconomicEnvelope;
  /** Cryptographic metadata */
  crypto: CryptoEnvelope;
}

/**
 * Full message with typed payload.
 */
export interface NootMessage extends NootMessageBase {
  /** Message payload - type depends on message type */
  payload: MessagePayload;
}

/**
 * Type-safe message with TASK payload.
 */
export interface TaskMessage extends NootMessageBase {
  type: MessageType.TASK;
  payload: TaskPayload;
}

/**
 * Type-safe message with QUERY payload.
 */
export interface QueryMessage extends NootMessageBase {
  type: MessageType.QUERY;
  payload: QueryPayload;
}

/**
 * Type-safe message with PROPOSAL payload.
 */
export interface ProposalMessage extends NootMessageBase {
  type: MessageType.PROPOSAL;
  payload: ProposalPayload;
}

/**
 * Type-safe message with ATTESTATION payload.
 */
export interface AttestationMessage extends NootMessageBase {
  type: MessageType.ATTESTATION;
  payload: AttestationPayload;
}

/**
 * Type-safe message with GRADIENT payload.
 */
export interface GradientMessage extends NootMessageBase {
  type: MessageType.GRADIENT;
  payload: GradientPayload;
}

/**
 * Type-safe message with STATE payload.
 */
export interface StateMessage extends NootMessageBase {
  type: MessageType.STATE;
  payload: StatePayload;
}

// ============================================================================
// Router Types (NIP-0012)
// ============================================================================

/**
 * Context for routing decisions.
 */
export interface RouterContext {
  /** Required profile level */
  profileLevel: number;
  /** Geographic/logical region preference */
  region?: string;
  /** Tenant isolation ID */
  tenantId?: string;
  /** Blackboard hints for routing */
  blackboardHints?: BlackboardHint[];
  /** Current workflow ID for correlation */
  workflowId?: string;
}

/**
 * Blackboard hint for routing decisions.
 */
export interface BlackboardHint {
  /** Capability this hint applies to */
  capability: string;
  /** Context hash for the hint */
  contextHash: string;
  /** Success weight (decayed) */
  successWeight: number;
  /** Failure weight (decayed) */
  failureWeight: number;
  /** Current congestion score (decayed) */
  congestionScore: number;
  /** Agents with routing preference */
  preferredAgents?: string[];
}

/**
 * Candidate target for routing.
 */
export interface CandidateTarget {
  /** Agent DID */
  agentId: string;
  /** Capability being requested */
  capability: string;
  /** Agent endpoint URL */
  endpoint: string;
  /** Agent's profile level */
  profileLevel: number;
  /** Agent's region */
  region?: string;
  /** Base price in NCR credits */
  basePriceNcr?: number;
  /** Historical performance stats */
  historicalStats?: TargetStats;
}

/**
 * Historical statistics for a routing target.
 */
export interface TargetStats {
  /** Overall reputation score (0-1) */
  reputationScore: number;
  /** Average latency in milliseconds */
  avgLatencyMs?: number;
  /** 95th percentile latency */
  p95LatencyMs?: number;
  /** Success rate (0-1) */
  successRate?: number;
  /** Total calls made */
  totalCalls?: number;
}

/**
 * Result of routing decision.
 */
export interface RoutedTarget {
  /** Selected agent DID */
  agentId: string;
  /** Capability being routed */
  capability: string;
  /** Agent endpoint URL */
  endpoint: string;
  /** Routing weight/score (0-1, normalized) */
  weight: number;
}

/**
 * Router interface - implemented by both legacy and coordination graph routers.
 */
export interface Router {
  /**
   * Select target(s) for a message from candidates.
   * @param message - The message to route
   * @param candidates - Available agents to route to
   * @param context - Routing context (profile, region, hints)
   * @returns Ranked list of targets with weights
   */
  selectTargets(
    message: NootMessage,
    candidates: CandidateTarget[],
    context: RouterContext
  ): Promise<RoutedTarget[]>;
}

// ============================================================================
// Blackboard Types (NIP-0012)
// ============================================================================

/**
 * Full blackboard record from database.
 */
export interface Blackboard {
  /** Unique ID */
  id: string;
  /** Namespace (e.g., "routing", "scheduling") */
  namespace: string;
  /** Capability this blackboard tracks */
  capability: string;
  /** Hash of problem context */
  contextHash: string;
  /** Success weight (pheromone) */
  successWeight: number;
  /** Failure weight (pheromone) */
  failureWeight: number;
  /** Congestion score (pheromone) */
  congestionScore: number;
  /** Agents with routing preference */
  preferredAgents: string[];
  /** Tags for filtering */
  tags: string[];
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Last update time (for decay calculation) */
  updatedAt: Date;
}

/**
 * Coordination edge for the coordination graph.
 */
export interface CoordinationEdge {
  /** Unique ID */
  id: string;
  /** Source capability */
  fromCapability: string;
  /** Target capability */
  toCapability: string;
  /** Profile level this edge applies to */
  profileLevel: number;
  /** Region this edge applies to */
  region?: string;
  /** Tenant ID for isolation */
  tenantId?: string;
  /** Number of calls on this edge */
  callCount: number;
  /** Successful calls */
  successCount: number;
  /** Failed calls */
  failureCount: number;
  /** Average latency in ms */
  avgLatencyMs?: number;
  /** 95th percentile latency */
  p95LatencyMs?: number;
  /** Average price in NCR */
  avgPriceNcr?: number;
  /** Derived reputation score (0-1) */
  reputationScore: number;
  /** Current congestion score (0-1) */
  congestionScore: number;
  /** Manual weight override */
  weightOverride?: number;
  /** Last time this edge was used */
  lastUsedAt?: Date;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a new TASK message.
 */
export function createTaskMessage(
  sender: string,
  capability: string,
  input: unknown,
  options?: {
    receiver?: string;
    correlationId?: string;
    profileLevel?: number;
    budgetNcr?: number;
    constraints?: TaskConstraints;
  }
): TaskMessage {
  return {
    id: crypto.randomUUID(),
    type: MessageType.TASK,
    timestamp: new Date().toISOString(),
    sender,
    receiver: options?.receiver,
    correlationId: options?.correlationId,
    profileLevel: options?.profileLevel ?? 0,
    economic: {
      currency: "NCR",
      budgetNcr: options?.budgetNcr,
    },
    crypto: {
      signatureType: "none",
      signer: sender,
      signature: "",
    },
    payload: {
      capability,
      input,
      constraints: options?.constraints,
    },
  };
}

/**
 * Create a new STATE message for blackboard update.
 */
export function createStateMessage(
  sender: string,
  namespace: string,
  capability: string,
  contextHash: string,
  delta: BlackboardDelta,
  options?: {
    correlationId?: string;
  }
): StateMessage {
  return {
    id: crypto.randomUUID(),
    type: MessageType.STATE,
    timestamp: new Date().toISOString(),
    sender,
    correlationId: options?.correlationId,
    profileLevel: 0,
    economic: {
      currency: "NCR",
    },
    crypto: {
      signatureType: "none",
      signer: sender,
      signature: "",
    },
    payload: {
      namespace,
      capability,
      contextHash,
      delta,
    },
  };
}

/**
 * Create a new GRADIENT message for routing feedback.
 */
export function createGradientMessage(
  sender: string,
  targetMessageId: string,
  reward: number,
  details?: GradientDetails,
  options?: {
    correlationId?: string;
  }
): GradientMessage {
  return {
    id: crypto.randomUUID(),
    type: MessageType.GRADIENT,
    timestamp: new Date().toISOString(),
    sender,
    correlationId: options?.correlationId,
    profileLevel: 0,
    economic: {
      currency: "NCR",
    },
    crypto: {
      signatureType: "none",
      signer: sender,
      signature: "",
    },
    payload: {
      targetMessageId,
      reward,
      details,
    },
  };
}
