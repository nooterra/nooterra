/**
 * @nooterra/types - Capability Types
 *
 * Type definitions for capabilities and the semantic discovery network.
 */

/**
 * Capability definition in the registry
 */
export interface CapabilityDefinition {
  /** Unique database ID */
  id: string;
  /** Capability ID (e.g., "cap.text.summarize.v1") */
  capabilityId: string;
  /** Agent DID that provides this capability */
  agentDid: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for inputs */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema for outputs */
  outputSchema?: Record<string, unknown>;
  /** Tags for categorization */
  tags?: string[];
  /** Risk level */
  riskLevel?: import("./policy.js").RiskLevel;
  /** Price in credits */
  priceCredits?: number;
  /** Embedding vector for semantic search */
  embedding?: number[];
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Capability category for the registry
 */
export type CapabilityCategory =
  | "text"       // Text processing (summarize, translate, etc.)
  | "code"       // Code generation, review, etc.
  | "creative"   // Image generation, audio, etc.
  | "data"       // Data processing, analysis
  | "workflow"   // Workflow planning, orchestration
  | "verify"     // Verification capabilities
  | "connector"  // External service connectors
  | "custom";    // Custom capabilities

/**
 * Discovery result from the semantic search
 */
export interface DiscoveryResult {
  /** Combined relevance score */
  score: number;
  /** Vector similarity score */
  vectorScore: number;
  /** Reputation contribution to score */
  reputationScore: number;
  /** Availability contribution to score */
  availabilityScore?: number;
  /** Agent DID */
  agentDid: string;
  /** Capability ID */
  capabilityId: string;
  /** Capability description */
  description: string;
  /** Tags */
  tags?: string[];
  /** Agent reputation */
  reputation: number | null;
  /** Agent health score */
  healthScore?: number;
  /** Agent information */
  agent?: {
    did: string;
    name: string | null;
    endpoint: string | null;
    reputation: number | null;
  };
}

/**
 * Discovery request parameters
 */
export interface DiscoveryRequest {
  /** Natural language query or intent */
  query?: string;
  /** Specific capability ID to match */
  capabilityId?: string;
  /** Tags to filter by */
  tags?: string[];
  /** Minimum reputation threshold */
  minReputation?: number;
  /** Minimum health score threshold */
  minHealthScore?: number;
  /** Maximum results to return */
  limit?: number;
  /** Whether to include unavailable agents */
  includeUnavailable?: boolean;
}

/**
 * Capability verification requirements
 */
export interface VerificationRequirements {
  /** Whether verification is required */
  required: boolean;
  /** Capability ID of the verifier to use */
  verifierCapabilityId?: string;
  /** Number of independent verifiers needed */
  redundancy?: number;
  /** Custom verification parameters */
  params?: Record<string, unknown>;
}

/**
 * Mapping from capability to its verifier
 */
export interface VerifierMapping {
  /** Source capability ID or pattern */
  sourceCapability: string;
  /** Verifier capability ID */
  verifierCapability: string;
  /** Whether this mapping is required or optional */
  required: boolean;
}

/**
 * Verification result from a verifier agent
 */
export interface VerificationResult {
  /** Whether verification passed */
  ok: boolean;
  /** Verification status */
  status: "passed" | "failed" | "error" | "timeout";
  /** Issues found (if any) */
  issues?: string[];
  /** Confidence score [0, 1] */
  confidence?: number;
  /** Execution metrics */
  metrics?: {
    latencyMs?: number;
    [key: string]: unknown;
  };
  /** Verifier agent DID */
  verifierDid?: string;
  /** Additional verification data */
  data?: Record<string, unknown>;
}

/**
 * Standard capability ID patterns
 */
export const CAPABILITY_PATTERNS = {
  // Text capabilities
  TEXT_SUMMARIZE: "cap.text.summarize.v1",
  TEXT_TRANSLATE: "cap.translate.v1",
  TEXT_EXTRACT: "cap.text.extract.v1",
  
  // Code capabilities
  CODE_GENERATE: "cap.code.generate.v1",
  CODE_REVIEW: "cap.code.review.v1",
  CODE_EXPLAIN: "cap.code.explain.v1",
  
  // Verification capabilities
  VERIFY_GENERIC: "cap.verify.generic.v1",
  VERIFY_CODE_TESTS: "cap.verify.code.tests.v1",
  VERIFY_SUMMARY_NLI: "cap.verify.summary.nli.v1",
  VERIFY_TRANSLATE_NLI: "cap.verify.translate.nli.v1",
  
  // Workflow capabilities
  PLAN_WORKFLOW: "cap.plan.workflow.v1",
  
  // Domain-specific
  CUSTOMS_CLASSIFY: "cap.customs.classify.v1",
  WEATHER_NOAA: "cap.weather.noaa.v1",
  RAIL_OPTIMIZE: "cap.rail.optimize.v1",
} as const;
