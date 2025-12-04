/**
 * @nooterra/types - Protocol Types
 *
 * Types for workflow cancellation, capability versioning, and scheduling.
 */

/**
 * Workflow cancellation request
 */
export interface CancelWorkflowRequest {
  reason?: string;
  force?: boolean;
}

/**
 * Workflow cancellation result
 */
export interface CancelWorkflowResult {
  workflowId: string;
  cancelledAt: Date;
  cancelledBy: string;
  nodesAffected: number;
  refundedCredits?: number;
}

/**
 * Capability version record
 */
export interface CapabilityVersion {
  id: number;
  capabilityId: string;
  version: string;
  schemaHash?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  deprecatedAt?: Date;
  successorVersion?: string;
  createdAt: Date;
}

/**
 * Version negotiation request
 */
export interface VersionNegotiationRequest {
  capabilityId: string;
  supportedVersions: string[];
  preferredVersion?: string;
}

/**
 * Version negotiation response
 */
export interface VersionNegotiationResult {
  capabilityId: string;
  selectedVersion: string;
  agentSupportedVersions: string[];
  isDeprecated: boolean;
  migrationPath?: string;
}

/**
 * Scheduled workflow definition
 */
export interface ScheduledWorkflow {
  id: string;
  templateId?: string;
  manifest: Record<string, unknown>;
  cronExpression?: string;
  nextRunAt?: Date;
  lastRunAt?: Date;
  lastRunWorkflowId?: string;
  enabled: boolean;
  timezone: string;
  payerDid?: string;
  maxCents?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Schedule creation request
 */
export interface CreateScheduleRequest {
  manifest: Record<string, unknown>;
  cronExpression: string;
  timezone?: string;
  payerDid?: string;
  maxCents?: number;
  enabled?: boolean;
}

/**
 * Cron schedule info
 */
export interface ScheduleInfo {
  cronExpression: string;
  timezone: string;
  nextRuns: Date[];
  humanReadable: string;
}
