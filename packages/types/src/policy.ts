/**
 * @nooterra/types - Policy Types
 *
 * Type definitions for policies, governance, and access control.
 */

/**
 * Risk level for capabilities
 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Policy scope
 */
export type PolicyScope = "global" | "project" | "workflow";

/**
 * Policy for workflow execution
 */
export interface Policy {
  /** Unique policy ID */
  id: string;
  /** Policy name */
  name: string;
  /** Policy scope */
  scope: PolicyScope;
  /** Associated project ID (for project-scoped policies) */
  projectId?: string;
  /** Minimum reputation required for agents */
  minReputation: number;
  /** Minimum health score required for agents */
  minHealthScore?: number;
  /** Whether to allow fallback agents */
  allowFallbackAgents: boolean;
  /** Maximum fallback attempts per node */
  maxFallbackAttempts: number;
  /** Maximum budget per workflow in credits */
  maxBudgetPerWorkflow?: number;
  /** Maximum concurrent workflows */
  maxConcurrentWorkflows?: number;
  /** Verification requirements */
  verification: {
    /** Whether verification is required */
    required: boolean;
    /** Number of verifiers required (for redundancy) */
    verifierCount?: number;
    /** Minimum verifier reputation */
    minVerifierReputation?: number;
  };
  /** Capability-specific overrides */
  capabilityOverrides?: Record<string, Partial<CapabilityPolicy>>;
  /** Allowed agent DIDs (whitelist, empty = all allowed) */
  allowedAgents?: string[];
  /** Blocked agent DIDs (blacklist) */
  blockedAgents?: string[];
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Capability-specific policy
 */
export interface CapabilityPolicy {
  /** Capability ID pattern (supports wildcards like "cap.code.*") */
  capabilityPattern: string;
  /** Risk level */
  riskLevel: RiskLevel;
  /** Minimum reputation for this capability */
  minReputation: number;
  /** Whether verification is required */
  requiresVerification: boolean;
  /** Maximum price in credits */
  maxPriceCredits?: number;
  /** Allowed agents for this capability */
  allowedAgents?: string[];
  /** Whether fallback is allowed */
  allowFallback: boolean;
}

/**
 * Project configuration
 */
export interface Project {
  /** Unique project ID */
  id: string;
  /** Project name */
  name: string;
  /** Owner user ID */
  ownerId: string;
  /** Description */
  description?: string;
  /** Associated policy ID */
  policyId?: string;
  /** Credit balance allocated to this project */
  creditBalance: number;
  /** API keys for this project */
  apiKeys: ProjectApiKey[];
  /** Workflow templates */
  workflowTemplates?: WorkflowTemplate[];
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * API key for a project
 */
export interface ProjectApiKey {
  /** Key ID */
  id: string;
  /** Key prefix (for display, e.g., "noot_...abc") */
  prefix: string;
  /** Hashed key value */
  keyHash: string;
  /** Key name/description */
  name: string;
  /** Permissions */
  permissions: ApiKeyPermission[];
  /** Expiration date (optional) */
  expiresAt?: Date;
  /** Creation timestamp */
  createdAt: Date;
  /** Last used timestamp */
  lastUsedAt?: Date;
}

/**
 * API key permissions
 */
export type ApiKeyPermission =
  | "workflow:read"
  | "workflow:write"
  | "workflow:execute"
  | "agent:read"
  | "agent:write"
  | "ledger:read"
  | "admin";

/**
 * Workflow template for reusable workflows
 */
export interface WorkflowTemplate {
  /** Template ID */
  id: string;
  /** Template name */
  name: string;
  /** Description */
  description?: string;
  /** Workflow manifest */
  manifest: import("./workflow.js").WorkflowManifest;
  /** Input parameters (for parameterized templates) */
  parameters?: TemplateParameter[];
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Template parameter definition
 */
export interface TemplateParameter {
  /** Parameter name */
  name: string;
  /** Parameter type */
  type: "string" | "number" | "boolean" | "object";
  /** Description */
  description?: string;
  /** Default value */
  defaultValue?: unknown;
  /** Whether parameter is required */
  required: boolean;
  /** JSON Schema for validation */
  schema?: Record<string, unknown>;
}

/**
 * Alert configuration
 */
export interface Alert {
  /** Alert ID */
  id: string;
  /** Alert type */
  alertType:
    | "stuck_workflow"
    | "high_failure_rate"
    | "dlq_threshold"
    | "budget_exceeded"
    | "agent_unhealthy"
    | "custom";
  /** Severity */
  severity: "info" | "warning" | "error" | "critical";
  /** Alert message */
  message: string;
  /** Associated entity (workflow ID, agent DID, etc.) */
  entityId?: string;
  /** Entity type */
  entityType?: "workflow" | "agent" | "project" | "capability";
  /** Additional data */
  data?: Record<string, unknown>;
  /** Whether alert has been acknowledged */
  acknowledged: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Acknowledged timestamp */
  acknowledgedAt?: Date;
}
