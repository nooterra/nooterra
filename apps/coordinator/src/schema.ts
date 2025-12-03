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
