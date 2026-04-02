/**
 * Canonical object type schemas — the nouns of the business.
 * Every object in the world model extends WorldObject.
 * Each type has a state schema (observed) and an estimated schema (inferred).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Object types
// ---------------------------------------------------------------------------

export const OBJECT_TYPES = [
  'party',
  'relationship',
  'conversation',
  'message',
  'document',
  'contract',
  'invoice',
  'payment',
  'order',
  'obligation',
  'account',
  'budget',
  'task',
  'schedule_slot',
  'asset',
  'ticket',
  'goal',
  'metric',
  'risk',
  'deal',
  'policy',
  'agent',
  'grant',
] as const;

export type ObjectType = (typeof OBJECT_TYPES)[number];

// ---------------------------------------------------------------------------
// Relationship types
// ---------------------------------------------------------------------------

export const RELATIONSHIP_TYPES = [
  'customer_of',
  'vendor_of',
  'employs',
  'manages',
  'about',
  'governs',
  'pays',
  'assigned_to',
  'owns',
  'delegated_to',
  'part_of',
  'follows',
  'blocks',
  'risks',
] as const;

export type RelationType = (typeof RELATIONSHIP_TYPES)[number];

// ---------------------------------------------------------------------------
// World Object base schema
// ---------------------------------------------------------------------------

export const WorldObjectSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  type: z.enum(OBJECT_TYPES),
  version: z.number().int().positive(),
  state: z.record(z.unknown()),              // Type-specific state (see schemas below)
  estimated: z.record(z.unknown()).default({}), // Hidden state from state estimator
  confidence: z.number().min(0).max(1).default(1),
  sources: z.array(z.object({
    system: z.string(),
    id: z.string(),
    lastSyncedAt: z.date().optional(),
  })).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
  validFrom: z.date(),
  validTo: z.date().optional(),              // null = current version
  tombstone: z.boolean().default(false),
  traceId: z.string().optional(),            // Trace that created/last updated this
});

export type WorldObject = z.infer<typeof WorldObjectSchema>;

// ---------------------------------------------------------------------------
// Relationship schema
// ---------------------------------------------------------------------------

export const RelationshipSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  type: z.enum(RELATIONSHIP_TYPES),
  fromId: z.string(),
  fromType: z.enum(OBJECT_TYPES),
  toId: z.string(),
  toType: z.enum(OBJECT_TYPES),
  properties: z.record(z.unknown()).default({}),
  strength: z.number().min(0).max(1).default(1),
  validFrom: z.date(),
  validTo: z.date().optional(),
});

export type Relationship = z.infer<typeof RelationshipSchema>;

// ---------------------------------------------------------------------------
// Domain-specific state schemas
// ---------------------------------------------------------------------------

export const PartyStateSchema = z.object({
  name: z.string(),
  type: z.enum(['customer', 'vendor', 'employee', 'partner', 'prospect']),
  identifiers: z.array(z.object({
    system: z.string(),
    id: z.string(),
  })).default([]),
  contactInfo: z.array(z.object({
    type: z.enum(['email', 'phone', 'address', 'website']),
    value: z.string(),
    primary: z.boolean().default(false),
  })).default([]),
  tags: z.array(z.string()).default([]),
});

export type PartyState = z.infer<typeof PartyStateSchema>;

export const PartyEstimatedSchema = z.object({
  engagementLevel: z.number().min(0).max(1).optional(),
  churnRisk: z.number().min(0).max(1).optional(),
  paymentReliability: z.number().min(0).max(1).optional(),
  lifetimeValueCents: z.number().int().optional(),
  sentiment: z.number().min(-1).max(1).optional(),
});

export type PartyEstimated = z.infer<typeof PartyEstimatedSchema>;

export const InvoiceStateSchema = z.object({
  number: z.string().optional(),
  amountCents: z.number().int(),
  currency: z.string().length(3).default('USD'),
  issuedAt: z.date().optional(),
  dueAt: z.date(),
  partyId: z.string(),                     // Who owes this
  lineItems: z.array(z.object({
    description: z.string(),
    amountCents: z.number().int(),
    quantity: z.number().default(1),
  })).default([]),
  status: z.enum([
    'draft', 'sent', 'viewed', 'partial', 'paid',
    'overdue', 'disputed', 'written_off', 'voided',
  ]),
  payments: z.array(z.string()).default([]),  // Payment object IDs
  amountPaidCents: z.number().int().default(0),
  amountRemainingCents: z.number().int(),
});

export type InvoiceState = z.infer<typeof InvoiceStateSchema>;

export const InvoiceEstimatedSchema = z.object({
  paymentProbability7d: z.number().min(0).max(1).optional(),
  paymentProbability14d: z.number().min(0).max(1).optional(),
  paymentProbability30d: z.number().min(0).max(1).optional(),
  expectedPaymentDate: z.date().optional(),
  disputeRisk: z.number().min(0).max(1).optional(),
});

export type InvoiceEstimated = z.infer<typeof InvoiceEstimatedSchema>;

export const PaymentStateSchema = z.object({
  amountCents: z.number().int(),
  currency: z.string().length(3).default('USD'),
  payerPartyId: z.string(),
  receiverPartyId: z.string().optional(),
  invoiceId: z.string().optional(),
  method: z.string().optional(),           // 'card', 'bank_transfer', 'check'
  status: z.enum(['pending', 'completed', 'failed', 'refunded', 'disputed']),
  paidAt: z.date().optional(),
  externalId: z.string().optional(),       // Stripe charge ID, etc.
});

export type PaymentState = z.infer<typeof PaymentStateSchema>;

export const ObligationStateSchema = z.object({
  type: z.enum(['payment', 'delivery', 'response', 'action', 'compliance']),
  description: z.string(),
  owedByPartyId: z.string(),
  owedToPartyId: z.string(),
  dueAt: z.date(),
  status: z.enum(['pending', 'fulfilled', 'overdue', 'breached', 'waived']),
  linkedObjectIds: z.array(z.string()).default([]),
});

export type ObligationState = z.infer<typeof ObligationStateSchema>;

export const ObligationEstimatedSchema = z.object({
  fulfillmentProbability: z.number().min(0).max(1).optional(),
  riskOfBreach: z.number().min(0).max(1).optional(),
});

export type ObligationEstimated = z.infer<typeof ObligationEstimatedSchema>;

export const ConversationStateSchema = z.object({
  subject: z.string().optional(),
  channel: z.enum(['email', 'chat', 'phone', 'meeting', 'sms']),
  participantPartyIds: z.array(z.string()).default([]),
  messageCount: z.number().int().default(0),
  lastActivityAt: z.date(),
  status: z.enum(['active', 'waiting', 'resolved', 'stale']),
  linkedObjectIds: z.array(z.string()).default([]),
  externalThreadId: z.string().optional(), // Gmail thread ID, etc.
});

export type ConversationState = z.infer<typeof ConversationStateSchema>;

export const ConversationEstimatedSchema = z.object({
  urgency: z.number().min(0).max(1).optional(),
  sentiment: z.number().min(-1).max(1).optional(),
  responseNeeded: z.boolean().optional(),
  expectedResponseBy: z.date().optional(),
});

export type ConversationEstimated = z.infer<typeof ConversationEstimatedSchema>;

export const TaskStateSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  assigneePartyId: z.string().optional(),
  assigneeAgentId: z.string().optional(),
  dueAt: z.date().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  linkedObjectIds: z.array(z.string()).default([]),
});

export type TaskState = z.infer<typeof TaskStateSchema>;

// ---------------------------------------------------------------------------
// Action classes (used by authority graph)
// ---------------------------------------------------------------------------

export const ACTION_CLASSES = [
  'communicate.email',
  'communicate.chat',
  'communicate.phone',
  'communicate.meeting',
  'financial.invoice.read',
  'financial.invoice.create',
  'financial.invoice.send',
  'financial.payment.read',
  'financial.payment.initiate',
  'financial.refund',
  'financial.quote',
  'document.read',
  'document.create',
  'document.sign',
  'document.share',
  'schedule.read',
  'schedule.create',
  'schedule.modify',
  'schedule.cancel',
  'task.read',
  'task.create',
  'task.assign',
  'task.complete',
  'data.read',
  'data.write',
  'data.delete',
  'agent.create',
  'agent.modify',
  'agent.delegate',
  'agent.pause',
] as const;

export type ActionClass = (typeof ACTION_CLASSES)[number];
