/**
 * Drizzle ORM Schema
 * 
 * Type-safe database schema definition for the coordinator service.
 * This replaces raw SQL with Drizzle's type-safe query builder.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uuid,
  numeric,
  varchar,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================================
// Users & Authentication
// ============================================================================

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  apiKeys: many(apiKeys),
  tasks: many(tasks),
}));

// ============================================================================
// Projects
// ============================================================================

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  payerDid: text("payer_did").notNull(),
  settings: jsonb("settings").default({}).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("projects_user_id_idx").on(table.userId),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  policy: one(policies),
  apiKeys: many(apiKeys),
  workflows: many(workflows),
}));

// ============================================================================
// Policies
// ============================================================================

export const policies = pgTable("policies", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  rules: jsonb("rules").notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// API Keys
// ============================================================================

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  scopes: jsonb("scopes").default(["*"]).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  useCount: integer("use_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("api_keys_user_id_idx").on(table.userId),
  projectIdIdx: index("api_keys_project_id_idx").on(table.projectId),
  keyHashIdx: uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [apiKeys.projectId],
    references: [projects.id],
  }),
}));

// ============================================================================
// Agents
// ============================================================================

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  did: text("did").notNull().unique(),
  name: text("name").notNull(),
  endpoint: text("endpoint").notNull(),
  capabilities: text("capabilities").array().default([]).notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  pricePerCall: numeric("price_per_call", { precision: 18, scale: 8 }).default("0").notNull(),
  healthStatus: varchar("health_status", { length: 20 }).default("unknown").notNull(),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  didIdx: uniqueIndex("agents_did_idx").on(table.did),
  healthIdx: index("agents_health_idx").on(table.healthStatus, table.isActive),
  capabilitiesIdx: index("agents_capabilities_idx").on(table.capabilities),
}));

// ============================================================================
// Workflows
// ============================================================================

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: integer("version").default(1).notNull(),
  dag: jsonb("dag").notNull(),
  inputSchema: jsonb("input_schema"),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  maxBudget: numeric("max_budget", { precision: 18, scale: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  projectIdIdx: index("workflows_project_id_idx").on(table.projectId),
  statusIdx: index("workflows_status_idx").on(table.status),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  project: one(projects, {
    fields: [workflows.projectId],
    references: [projects.id],
  }),
  runs: many(workflowRuns),
}));

// ============================================================================
// Workflow Runs
// ============================================================================

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "cascade" }).notNull(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  input: jsonb("input").default({}).notNull(),
  output: jsonb("output"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  currentNode: text("current_node"),
  nodeResults: jsonb("node_results").default({}).notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  workflowIdIdx: index("workflow_runs_workflow_id_idx").on(table.workflowId),
  statusIdx: index("workflow_runs_status_idx").on(table.status),
  createdAtIdx: index("workflow_runs_created_at_idx").on(table.createdAt),
}));

export const workflowRunsRelations = relations(workflowRuns, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowRuns.workflowId],
    references: [workflows.id],
  }),
}));

// ============================================================================
// Tasks
// ============================================================================

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  agentDid: text("agent_did"),
  workflowId: uuid("workflow_id").references(() => workflows.id),
  workerId: text("worker_id"),
  input: jsonb("input").default({}).notNull(),
  output: jsonb("output"),
  error: text("error"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  priority: integer("priority").default(50).notNull(),
  progress: integer("progress").default(0).notNull(),
  timeout: integer("timeout").default(300).notNull(),
  retries: integer("retries").default(3).notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("tasks_user_id_idx").on(table.userId),
  statusIdx: index("tasks_status_idx").on(table.status),
  priorityIdx: index("tasks_priority_idx").on(table.priority),
  scheduledAtIdx: index("tasks_scheduled_at_idx").on(table.scheduledAt),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  user: one(users, {
    fields: [tasks.userId],
    references: [users.id],
  }),
  logs: many(taskLogs),
}));

// ============================================================================
// Task Logs
// ============================================================================

export const taskLogs = pgTable("task_logs", {
  id: serial("id").primaryKey(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }).notNull(),
  level: varchar("level", { length: 10 }).notNull(),
  message: text("message").notNull(),
  data: jsonb("data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  taskIdIdx: index("task_logs_task_id_idx").on(table.taskId),
  createdAtIdx: index("task_logs_created_at_idx").on(table.createdAt),
}));

export const taskLogsRelations = relations(taskLogs, ({ one }) => ({
  task: one(tasks, {
    fields: [taskLogs.taskId],
    references: [tasks.id],
  }),
}));

// ============================================================================
// Ledger Accounts
// ============================================================================

export const ledgerAccounts = pgTable("ledger_accounts", {
  ownerDid: text("owner_did").primaryKey(),
  balance: numeric("balance", { precision: 18, scale: 8 }).default("0").notNull(),
  currency: varchar("currency", { length: 10 }).default("credits").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// Ledger Events
// ============================================================================

export const ledgerEvents = pgTable("ledger_events", {
  id: serial("id").primaryKey(),
  ownerDid: text("owner_did").notNull(),
  amount: numeric("amount", { precision: 18, scale: 8 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("credits").notNull(),
  eventType: varchar("event_type", { length: 30 }).notNull(),
  workflowId: uuid("workflow_id"),
  nodeName: text("node_name"),
  description: text("description"),
  traceId: text("trace_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  ownerDidIdx: index("ledger_events_owner_did_idx").on(table.ownerDid),
  eventTypeIdx: index("ledger_events_event_type_idx").on(table.eventType),
  createdAtIdx: index("ledger_events_created_at_idx").on(table.createdAt),
}));

// ============================================================================
// System Settings
// ============================================================================

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// Feature Flags
// ============================================================================

export const featureFlags = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  enabled: boolean("enabled").default(false).notNull(),
  description: text("description"),
  rules: jsonb("rules").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  nameIdx: uniqueIndex("feature_flags_name_idx").on(table.name),
}));

// ============================================================================
// Audit Logs
// ============================================================================

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: varchar("action", { length: 50 }).notNull(),
  resourceType: varchar("resource_type", { length: 50 }),
  resourceId: text("resource_id"),
  details: jsonb("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("audit_logs_user_id_idx").on(table.userId),
  actionIdx: index("audit_logs_action_idx").on(table.action),
  createdAtIdx: index("audit_logs_created_at_idx").on(table.createdAt),
}));

// ============================================================================
// Agent Calls (for stats tracking)
// ============================================================================

export const agentCalls = pgTable("agent_calls", {
  id: serial("id").primaryKey(),
  agentDid: text("agent_did").notNull(),
  workflowRunId: uuid("workflow_run_id"),
  nodeName: text("node_name"),
  input: jsonb("input"),
  output: jsonb("output"),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  agentDidIdx: index("agent_calls_agent_did_idx").on(table.agentDid),
  statusIdx: index("agent_calls_status_idx").on(table.status),
  createdAtIdx: index("agent_calls_created_at_idx").on(table.createdAt),
}));

// ============================================================================
// Dispatch Queue (Postgres fallback when Redis unavailable)
// ============================================================================

export const dispatchQueue = pgTable("dispatch_queue", {
  id: serial("id").primaryKey(),
  workflowId: text("workflow_id").notNull(),
  nodeName: text("node_name").notNull(),
  agentDid: text("agent_did").notNull(),
  payload: text("payload").notNull(),
  attempt: integer("attempt").default(0).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  traceId: text("trace_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimedBy: text("claimed_by"),
}, (table) => ({
  statusIdx: index("dispatch_queue_status_idx").on(table.status),
  createdAtIdx: index("dispatch_queue_created_at_idx").on(table.createdAt),
}));

export type DispatchQueueItem = typeof dispatchQueue.$inferSelect;
export type NewDispatchQueueItem = typeof dispatchQueue.$inferInsert;

// ============================================================================
// Node Bids (Auction System)
// ============================================================================

export const nodeBids = pgTable("node_bids", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, { onDelete: "cascade" }).notNull(),
  nodeName: text("node_name").notNull(),
  agentDid: text("agent_did").notNull(),
  bidAmount: numeric("bid_amount", { precision: 18, scale: 8 }).notNull(),
  etaMs: integer("eta_ms"),                                    // Estimated time to complete
  stakeOffered: numeric("stake_offered", { precision: 18, scale: 8 }).default("0").notNull(),
  capabilities: text("capabilities").array().default([]).notNull(),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, accepted, rejected, expired, withdrawn
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  workflowNodeIdx: index("node_bids_workflow_node_idx").on(table.workflowRunId, table.nodeName),
  agentIdx: index("node_bids_agent_idx").on(table.agentDid),
  statusIdx: index("node_bids_status_idx").on(table.status),
}));

// ============================================================================
// Ledger Escrow (Staking & Locked Funds)
// ============================================================================

export const ledgerEscrow = pgTable("ledger_escrow", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountDid: text("account_did").notNull(),
  workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
  nodeName: text("node_name"),
  amount: numeric("amount", { precision: 18, scale: 8 }).notNull(),
  escrowType: varchar("escrow_type", { length: 20 }).notNull(), // stake, payment, bid_deposit
  status: varchar("status", { length: 20 }).default("held").notNull(), // held, released, slashed, refunded
  reason: text("reason"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  accountIdx: index("ledger_escrow_account_idx").on(table.accountDid),
  workflowIdx: index("ledger_escrow_workflow_idx").on(table.workflowRunId),
  statusIdx: index("ledger_escrow_status_idx").on(table.status),
}));

// ============================================================================
// Workflow Memory (Shared Context)
// ============================================================================

export const workflowMemory = pgTable("workflow_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, { onDelete: "cascade" }).notNull(),
  key: text("key").notNull(),
  value: jsonb("value"),
  createdBy: text("created_by"),                               // Agent DID that wrote this
  namespace: varchar("namespace", { length: 50 }).default("shared").notNull(), // shared, agent:<did>, system
  ttlSeconds: integer("ttl_seconds"),                          // Optional TTL
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  workflowKeyIdx: uniqueIndex("workflow_memory_workflow_key_idx").on(table.workflowRunId, table.namespace, table.key),
  workflowIdx: index("workflow_memory_workflow_idx").on(table.workflowRunId),
}));

// ============================================================================
// Workflow Templates (Pre-built DAGs)
// ============================================================================

export const workflowTemplates = pgTable("workflow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  category: varchar("category", { length: 50 }),               // research, code-review, content, data, etc.
  dag: jsonb("dag").notNull(),
  inputSchema: jsonb("input_schema"),
  outputSchema: jsonb("output_schema"),
  defaultSettings: jsonb("default_settings").default({}).notNull(),
  isPublic: boolean("is_public").default(true).notNull(),
  isFeatured: boolean("is_featured").default(false).notNull(),
  usageCount: integer("usage_count").default(0).notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex("workflow_templates_slug_idx").on(table.slug),
  categoryIdx: index("workflow_templates_category_idx").on(table.category),
  featuredIdx: index("workflow_templates_featured_idx").on(table.isFeatured, table.isPublic),
}));

// ============================================================================
// Agent Stakes (Persistent Agent Staking)
// ============================================================================

export const agentStakes = pgTable("agent_stakes", {
  agentDid: text("agent_did").primaryKey(),
  stakedAmount: numeric("staked_amount", { precision: 18, scale: 8 }).default("0").notNull(),
  lockedAmount: numeric("locked_amount", { precision: 18, scale: 8 }).default("0").notNull(), // Currently in use
  totalSlashed: numeric("total_slashed", { precision: 18, scale: 8 }).default("0").notNull(),
  lastStakeAt: timestamp("last_stake_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// Budget Reservations (Pre-dispatch budget locking)
// ============================================================================

export const budgetReservations = pgTable("budget_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "cascade" }).notNull(),
  nodeName: text("node_name").notNull(),
  capabilityId: text("capability_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  payerDid: text("payer_did").notNull(),
  status: text("status").notNull().default("reserved"), // 'reserved' | 'consumed' | 'released'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  workflowNodeIdx: uniqueIndex("budget_reservations_workflow_node_idx").on(table.workflowId, table.nodeName),
  statusIdx: index("budget_reservations_status_idx").on(table.status),
}));

// ============================================================================
// Fault Traces (Blame attribution for failed nodes)
// ============================================================================

export const faultTraces = pgTable("fault_traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "cascade" }).notNull(),
  nodeName: text("node_name").notNull(),
  faultType: text("fault_type").notNull(), // 'timeout' | 'error' | 'schema_violation' | 'upstream_fault'
  blamedDid: text("blamed_did"), // The agent DID at fault (null if requester fault)
  evidence: jsonb("evidence").default({}).notNull(), // Schema errors, timing data, etc.
  refundAmount: numeric("refund_amount", { precision: 18, scale: 8 }),
  refundedTo: text("refunded_to"), // DID that received the refund
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  workflowIdx: index("fault_traces_workflow_idx").on(table.workflowId),
  blamedIdx: index("fault_traces_blamed_idx").on(table.blamedDid),
  faultTypeIdx: index("fault_traces_type_idx").on(table.faultType),
}));

// ============================================================================
// Agent Reputation v2 (Multi-dimensional)
// ============================================================================

export const agentReputation = pgTable("agent_reputation", {
  agentDid: text("agent_did").primaryKey(),
  overallScore: numeric("overall_score", { precision: 5, scale: 4 }).default("0.5").notNull(), // 0-1
  successRate: numeric("success_rate", { precision: 5, scale: 4 }).default("0").notNull(),
  avgLatencyMs: integer("avg_latency_ms"),
  verificationScore: numeric("verification_score", { precision: 5, scale: 4 }).default("0.5").notNull(),
  pageRank: numeric("page_rank", { precision: 10, scale: 8 }).default("0.001").notNull(),
  coalitionScore: numeric("coalition_score", { precision: 5, scale: 4 }).default("0.5").notNull(),
  totalTasks: integer("total_tasks").default(0).notNull(),
  successfulTasks: integer("successful_tasks").default(0).notNull(),
  failedTasks: integer("failed_tasks").default(0).notNull(),
  timedOutTasks: integer("timed_out_tasks").default(0).notNull(),
  capabilityScores: jsonb("capability_scores").default({}).notNull(), // { "text-gen": { attempts: 10, successes: 9, avgQuality: 0.85 } }
  capabilityPercentiles: jsonb("capability_percentiles").default({}).notNull(), // { "text-gen": 0.85 } - percentile rank per capability
  overallPercentile: numeric("overall_percentile", { precision: 5, scale: 4 }).default("0.5").notNull(), // Global percentile rank
  endorsements: text("endorsements").array().default([]).notNull(),   // DIDs of endorsers
  lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  overallScoreIdx: index("agent_reputation_score_idx").on(table.overallScore),
}));

// ============================================================================
// Endorsements (Agent-to-Agent Trust)
// ============================================================================

export const endorsements = pgTable("endorsements", {
  id: uuid("id").primaryKey().defaultRandom(),
  endorserDid: text("endorser_did").notNull(),
  endorseeDid: text("endorsee_did").notNull(),
  weight: numeric("weight", { precision: 5, scale: 4 }).default("1").notNull(), // 0-1 endorsement strength
  capabilities: text("capabilities").array().default([]).notNull(), // Specific capabilities endorsed
  reason: text("reason"),
  isActive: boolean("is_active").default(true).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  endorserIdx: index("endorsements_endorser_idx").on(table.endorserDid),
  endorseeIdx: index("endorsements_endorsee_idx").on(table.endorseeDid),
  pairIdx: uniqueIndex("endorsements_pair_idx").on(table.endorserDid, table.endorseeDid),
}));

// ============================================================================
// Coordination Graph - Edges (NIP-0012)
// ============================================================================

export const coordinationEdges = pgTable("coordination_edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromCapability: text("from_capability").notNull(),
  toCapability: text("to_capability").notNull(),
  profileLevel: integer("profile_level").notNull().default(0),
  region: text("region"),
  tenantId: uuid("tenant_id"),

  // Aggregated statistics
  callCount: integer("call_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  avgLatencyMs: numeric("avg_latency_ms", { precision: 10, scale: 2 }),
  p95LatencyMs: numeric("p95_latency_ms", { precision: 10, scale: 2 }),
  avgPriceNcr: numeric("avg_price_ncr", { precision: 18, scale: 8 }),

  // Derived scores
  reputationScore: numeric("reputation_score", { precision: 5, scale: 4 }).default("0.0"),
  congestionScore: numeric("congestion_score", { precision: 5, scale: 4 }).default("0.0"),

  // Manual overrides
  weightOverride: numeric("weight_override", { precision: 5, scale: 4 }),

  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  metadata: jsonb("metadata").default({}).notNull(),
}, (table) => ({
  capabilityPairIdx: uniqueIndex("coordination_edges_pair_idx").on(
    table.fromCapability,
    table.toCapability,
    table.profileLevel,
    table.region,
    table.tenantId
  ),
  fromCapIdx: index("coordination_edges_from_idx").on(table.fromCapability),
  toCapIdx: index("coordination_edges_to_idx").on(table.toCapability),
}));

// ============================================================================
// Stigmergic Blackboards (NIP-0012)
// ============================================================================

export const blackboards = pgTable("blackboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  namespace: text("namespace").notNull(),
  capability: text("capability").notNull(),
  contextHash: text("context_hash").notNull(),

  // Pheromone values (decayed on read)
  successWeight: numeric("success_weight", { precision: 10, scale: 4 }).default("0.0").notNull(),
  failureWeight: numeric("failure_weight", { precision: 10, scale: 4 }).default("0.0").notNull(),
  congestionScore: numeric("congestion_score", { precision: 5, scale: 4 }).default("0.0").notNull(),

  // Routing hints
  preferredAgents: text("preferred_agents").array().default([]),
  tags: text("tags").array().default([]),
  metadata: jsonb("metadata").default({}).notNull(),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  blackboardKeyIdx: uniqueIndex("blackboards_key_idx").on(
    table.namespace,
    table.capability,
    table.contextHash
  ),
  capabilityIdx: index("blackboards_capability_idx").on(table.capability),
  namespaceIdx: index("blackboards_namespace_idx").on(table.namespace),
}));

export const blackboardEvents = pgTable("blackboard_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  blackboardId: uuid("blackboard_id").references(() => blackboards.id, { onDelete: "cascade" }).notNull(),
  eventType: text("event_type").notNull(), // "success", "failure", "congestion"

  deltaSuccess: numeric("delta_success", { precision: 10, scale: 4 }),
  deltaFailure: numeric("delta_failure", { precision: 10, scale: 4 }),
  deltaCongestion: numeric("delta_congestion", { precision: 5, scale: 4 }),

  sourceWorkflowId: uuid("source_workflow_id"),
  sourceAgentId: text("source_agent_id"),
  metadata: jsonb("metadata").default({}).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  blackboardIdIdx: index("blackboard_events_bb_idx").on(table.blackboardId),
  createdAtIdx: index("blackboard_events_created_idx").on(table.createdAt),
}));

// ============================================================================
// Type Exports
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type LedgerEvent = typeof ledgerEvents.$inferSelect;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

export type NodeBid = typeof nodeBids.$inferSelect;
export type NewNodeBid = typeof nodeBids.$inferInsert;

export type LedgerEscrowRecord = typeof ledgerEscrow.$inferSelect;
export type NewLedgerEscrow = typeof ledgerEscrow.$inferInsert;

export type WorkflowMemoryRecord = typeof workflowMemory.$inferSelect;
export type NewWorkflowMemory = typeof workflowMemory.$inferInsert;

export type WorkflowTemplate = typeof workflowTemplates.$inferSelect;
export type NewWorkflowTemplate = typeof workflowTemplates.$inferInsert;

export type AgentStake = typeof agentStakes.$inferSelect;
export type AgentReputationRecord = typeof agentReputation.$inferSelect;
export type Endorsement = typeof endorsements.$inferSelect;

export type BudgetReservation = typeof budgetReservations.$inferSelect;
export type NewBudgetReservation = typeof budgetReservations.$inferInsert;

export type FaultTrace = typeof faultTraces.$inferSelect;
export type NewFaultTrace = typeof faultTraces.$inferInsert;

export type CoordinationEdge = typeof coordinationEdges.$inferSelect;
export type NewCoordinationEdge = typeof coordinationEdges.$inferInsert;

export type Blackboard = typeof blackboards.$inferSelect;
export type NewBlackboard = typeof blackboards.$inferInsert;

export type BlackboardEvent = typeof blackboardEvents.$inferSelect;
export type NewBlackboardEvent = typeof blackboardEvents.$inferInsert;
