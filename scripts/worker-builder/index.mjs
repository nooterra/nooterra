/**
 * Worker Builder Module
 * 
 * The complete system for creating and running AI workers with guardrails.
 * 
 * Components:
 * - Capability Registry: What workers can connect to
 * - Charter Compiler: Converts conversation to structured rules
 * - Worker Builder Core: Conversational worker creation
 * - Trigger Engine: Schedules, webhooks, watchers
 * - Notification Bus: Alerts across channels
 * - Worker Memory: Persistent context
 * - Worker Persistence: Save/load workers
 * - Provider Auth: AI provider connections
 * - MCP Integration: Connect to MCP servers
 * - Error Handling: Graceful errors
 */

// Core components
export { default as capabilityRegistry } from './capability-registry.mjs';
export { default as charterCompiler } from './charter-compiler.mjs';
export { default as workerBuilderCore } from './worker-builder-core.mjs';
export { default as triggerEngine } from './trigger-engine.mjs';
export { default as notificationBus } from './notification-bus.mjs';
export { default as workerMemory } from './worker-memory.mjs';
export { default as workerPersistence } from './worker-persistence.mjs';
export { default as providerAuth } from './provider-auth.mjs';
export { default as mcpIntegration } from './mcp-integration.mjs';
export { default as errorHandling } from './error-handling.mjs';

// Specific exports for common use
export {
  getAllCapabilities,
  getCapability,
  inferCapabilities
} from './capability-registry.mjs';

export {
  createEmptyCharter,
  buildCharterFromContext,
  generateCharterSummary,
  validateCharter
} from './charter-compiler.mjs';

// Alias for convenience
export { buildCharterFromContext as compileCharter } from './charter-compiler.mjs';

export {
  createConversation,
  processInput,
  getConversationState,
  generateResponse,
  CONVERSATION_STATES
} from './worker-builder-core.mjs';

export {
  TriggerEngine,
  getTriggerEngine,
  createScheduleTrigger,
  createWebhookTrigger,
  createFileWatchTrigger,
  TRIGGER_TYPES
} from './trigger-engine.mjs';

export {
  NotificationBus,
  getNotificationBus,
  CHANNELS,
  EVENTS
} from './notification-bus.mjs';

export {
  WorkerMemory,
  getMemoryManager,
  getWorkerMemory
} from './worker-memory.mjs';

export {
  createWorker,
  loadWorker,
  saveWorker,
  listWorkers,
  deleteWorker,
  findWorkerByName,
  updateWorkerStatus,
  getWorkerSummary,
  getAllWorkerSummaries,
  WORKER_STATUS
} from './worker-persistence.mjs';

export {
  listProviders,
  saveApiKey,
  loadApiKey,
  testProvider,
  hasCredentials,
  loadCredentials
} from './provider-auth.mjs';

export {
  listAvailableServers,
  getConnectionManager,
  quickConnect,
  quickDisconnect,
  callTool,
  KNOWN_SERVERS
} from './mcp-integration.mjs';

export {
  ERROR_CODES,
  NooteraError,
  createError,
  withErrorHandling,
  retry
} from './error-handling.mjs';
