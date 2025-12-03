/**
 * @nooterra/types - Workflow Types
 *
 * Core type definitions for workflow manifests, nodes, and execution.
 */

/**
 * Status of a workflow execution
 */
export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

/**
 * Status of an individual node in a workflow
 */
export type NodeStatus =
  | "pending"
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "timeout";

/**
 * Trigger types for workflow execution
 */
export type TriggerType = "manual" | "scheduled" | "webhook" | "event";

/**
 * Definition of a single node in a workflow DAG
 */
export interface WorkflowNodeDef {
  /** Capability ID required for this node (e.g., "cap.text.summarize.v1") */
  capabilityId: string;
  /** Array of node names this node depends on */
  dependsOn?: string[];
  /** Static payload to pass to the agent */
  payload?: Record<string, unknown>;
  /** Dynamic input mappings from parent nodes (e.g., { "text": "$.Summarize_1.result.summary" }) */
  inputMappings?: Record<string, string>;
  /** Whether this node requires verification */
  requiresVerification?: boolean;
  /** Maximum time allowed for this node in milliseconds */
  timeoutMs?: number;
  /** Maximum retry attempts for this node */
  maxRetries?: number;
}

/**
 * Complete workflow definition (the DAG manifest)
 */
export interface WorkflowManifest {
  /** Human-readable intent/description of the workflow */
  intent?: string;
  /** The DAG of nodes, keyed by node name */
  nodes: Record<string, WorkflowNodeDef>;
  /** Trigger configuration */
  trigger?: {
    type: TriggerType;
    config?: Record<string, unknown>;
  };
  /** Global workflow settings */
  settings?: {
    /** Maximum total runtime in milliseconds */
    maxRuntimeMs?: number;
    /** Whether to allow fallback agents */
    allowFallbackAgents?: boolean;
    /** Maximum budget in credits */
    maxBudgetCredits?: number;
  };
}

/**
 * Node execution result
 */
export interface NodeResult {
  /** The agent's output */
  result: unknown;
  /** Execution metrics */
  metrics?: {
    latencyMs?: number;
    tokenCount?: number;
    [key: string]: unknown;
  };
  /** Optional verification details */
  verification?: {
    status: "passed" | "failed" | "skipped";
    verifierDid?: string;
    issues?: string[];
  };
}

/**
 * Runtime state of a workflow node
 */
export interface WorkflowNode {
  /** Node name (key in the manifest) */
  name: string;
  /** Current status */
  status: NodeStatus;
  /** Capability being executed */
  capabilityId: string;
  /** Agent assigned to this node */
  agentDid?: string;
  /** Node dependencies */
  dependsOn: string[];
  /** Input payload sent to agent */
  input?: unknown;
  /** Output from agent */
  output?: NodeResult;
  /** Error message if failed */
  error?: string;
  /** Timestamps */
  timestamps: {
    createdAt: Date;
    dispatchedAt?: Date;
    completedAt?: Date;
  };
  /** Retry count */
  retryCount: number;
}

/**
 * Complete workflow instance (runtime state)
 */
export interface Workflow {
  /** Unique workflow ID */
  id: string;
  /** Original manifest */
  manifest: WorkflowManifest;
  /** Current status */
  status: WorkflowStatus;
  /** Node states */
  nodes: Record<string, WorkflowNode>;
  /** Payer/owner DID */
  payerDid: string;
  /** Project ID if applicable */
  projectId?: string;
  /** Policy snapshot at time of creation */
  policySnapshot?: Record<string, unknown>;
  /** Timestamps */
  timestamps: {
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
  };
  /** Total credits spent */
  creditsSpent: number;
  /** Webhook URL for notifications */
  webhookUrl?: string;
}

/**
 * Selection log entry for agent selection decisions
 */
export interface SelectionLog {
  /** Workflow ID */
  workflowId: string;
  /** Node name */
  nodeName: string;
  /** Capability required */
  capabilityId: string;
  /** Candidates considered */
  candidates: Array<{
    agentDid: string;
    score: number;
    reputation: number;
    healthScore: number;
    selected: boolean;
    reason?: string;
  }>;
  /** Selected agent */
  selectedAgent?: string;
  /** Fallback attempts */
  fallbackChain?: Array<{
    agentDid: string;
    outcome: "success" | "timeout" | "error";
    errorMessage?: string;
  }>;
  /** Timestamp */
  timestamp: Date;
}
