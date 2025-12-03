/**
 * @nooterra/types
 *
 * Shared type definitions for the Nooterra protocol.
 * This package provides TypeScript types used across all Nooterra services.
 */

// Workflow types
export {
  type WorkflowStatus,
  type NodeStatus,
  type TriggerType,
  type WorkflowNodeDef,
  type WorkflowManifest,
  type NodeResult,
  type WorkflowNode,
  type Workflow,
  type SelectionLog,
} from "./workflow.js";

// Agent types
export {
  type AgentCard,
  type AgentCapability,
  type Agent,
  type AgentStats,
  type AgentHealth,
  type HandlerContext,
  type HandlerResult,
  type AgentHooks,
  type AgentConfig,
} from "./agent.js";

// Ledger types
export {
  type Currency,
  type LedgerEntryType,
  type AccountType,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerEvent,
  type LedgerBatch,
  type CapabilityPricing,
  type UsageSummary,
  type AgentEarnings,
} from "./ledger.js";

// Policy types
export {
  type RiskLevel,
  type PolicyScope,
  type Policy,
  type CapabilityPolicy,
  type Project,
  type ProjectApiKey,
  type ApiKeyPermission,
  type WorkflowTemplate,
  type TemplateParameter,
  type Alert,
} from "./policy.js";

// Capability types
export {
  type CapabilityDefinition,
  type CapabilityCategory,
  type DiscoveryResult,
  type DiscoveryRequest,
  type VerificationRequirements,
  type VerifierMapping,
  type VerificationResult,
  CAPABILITY_PATTERNS,
} from "./capability.js";
