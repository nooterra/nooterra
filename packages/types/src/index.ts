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
  type ProfileDeclaration,
  type EconomicsConfig,
  type ReceiptClaims,
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

// Semantic type system
export {
  type SemanticType,
  type TypeConverter,
  type TypeRegistryEntry,
  getSemanticType,
  getTypesByDomain,
  getAllDomains,
  validateAgainstType,
  ALL_SEMANTIC_TYPES,
} from "./semantic-types.js";

// Capability schemas
export {
  type CapabilitySchema,
  type SchemaField,
  getCapabilitySchema,
  getCapabilitySchemasByDomain,
  getAllCapabilityDomains,
  BUILTIN_CAPABILITY_SCHEMAS,
  CapabilitySchemaValidator,
} from "./capability-schemas.js";

// Compatibility checking
export {
  type DAGNode,
  type WorkflowDAG,
  type ConnectionCompatibility,
  type DAGValidationResult,
  type SuggestedAdapter,
  checkCapabilityCompatibility,
  validateDAG,
  findCompatibleCapabilities,
  autoInsertAdapters,
} from "./compatibility.js";

// Trust layer types
export {
  type RevokedDid,
  type KeyRotation,
  type SignedResult,
  type RevocationRequest,
  type KeyRotationRequest,
  type SignResultPayload,
} from "./trust.js";

// Accountability types
export {
  type AuditEntry,
  type AuditEventType,
  type TaskReceipt,
  type TraceSpan,
  type TraceEvent,
  type AuditQuery,
  type TraceQuery,
} from "./accountability.js";

// Protocol types
export {
  type CancelWorkflowRequest,
  type CancelWorkflowResult,
  type CapabilityVersion,
  type VersionNegotiationRequest,
  type VersionNegotiationResult,
  type ScheduledWorkflow,
  type CreateScheduleRequest,
  type ScheduleInfo,
} from "./protocol.js";

// Identity types
export {
  type AgentInheritance,
  type SetInheritanceRequest,
  type AgentName,
  type RegisterNameRequest,
  type RecoveryRequest,
  type DeadManSwitchResult,
} from "./identity.js";

// Economics types
export {
  type Invoice,
  type InvoiceStatus,
  type GenerateInvoiceRequest,
  type Dispute,
  type DisputeType,
  type DisputeStatus,
  type OpenDisputeRequest,
  type ResolveDisputeRequest,
  type UsageQuota,
  type QuotaCheckResult,
  type SettlementRequest,
  type SettlementResult,
} from "./economics.js";

// Federation types
export {
  type CoordinatorPeer,
  type PrivateSubnet,
  type SubnetRoutingRequest,
  type GeoRegion,
  type GeoRoutingPreference,
  type GossipMessage,
  type GossipMessageType,
  type WorkflowHandoff,
  type FederationStatus,
} from "./federation.js";

// Message types (NIP-0012 Coordination Graph)
export {
  MessageType,
  type EconomicEnvelope,
  type CryptoEnvelope,
  type TaskPayload,
  type TaskConstraints,
  type QueryPayload,
  type ProposalPayload,
  type AttestationPayload,
  type GradientPayload,
  type GradientDetails,
  type StatePayload,
  type BlackboardDelta,
  type MessagePayload,
  type NootMessageBase,
  type NootMessage,
  type TaskMessage,
  type QueryMessage,
  type ProposalMessage,
  type AttestationMessage,
  type GradientMessage,
  type StateMessage,
  type RouterContext,
  type BlackboardHint,
  type CandidateTarget,
  type TargetStats,
  type RoutedTarget,
  type Router,
  type Blackboard,
  type CoordinationEdge,
  createTaskMessage,
  createStateMessage,
  createGradientMessage,
} from "./message.js";
