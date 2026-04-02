/**
 * AR Collections Agent — the first domain agent.
 *
 * Handles invoice follow-up, payment reminders, and dispute triage.
 * Operates within a typed authority grant with explicit scope:
 * - communicate.email (known customers, invoices < $50K)
 * - financial.invoice.read
 * - data.read
 * - task.create
 *
 * Collection playbook (encoded as policy, not hardcoded):
 * 1. Friendly reminder (3 days overdue)
 * 2. Formal notice (14 days overdue)
 * 3. Escalation to human (30 days overdue or dispute detected)
 */

import type { AgentConfig } from '../runtime.js';
import type { CreateGrantInput, GrantScope, GrantConstraints } from '../../policy/authority-graph.js';
import type { ToolDefinition } from '../runtime.js';

// ---------------------------------------------------------------------------
// Agent configuration
// ---------------------------------------------------------------------------

export function createCollectionsAgent(tenantId: string, agentId: string): AgentConfig {
  return {
    id: agentId,
    tenantId,
    name: 'Collections Agent',
    role: 'Accounts Receivable Collections Specialist',
    model: 'anthropic/claude-sonnet-4-6',
    actionClasses: [
      'communicate.email',
      'financial.invoice.read',
      'data.read',
      'task.create',
    ],
    domainInstructions: COLLECTIONS_INSTRUCTIONS,
    playbook: COLLECTIONS_PLAYBOOK,
  };
}

// ---------------------------------------------------------------------------
// Authority grant
// ---------------------------------------------------------------------------

export function createCollectionsGrant(
  tenantId: string,
  grantorId: string,
  granteeId: string,
): CreateGrantInput {
  const scope: GrantScope = {
    actionClasses: [
      'communicate.email',
      'financial.invoice.read',
      'financial.payment.read',
      'data.read',
      'task.create',
    ],
    objectTypes: ['invoice', 'party', 'payment', 'conversation', 'obligation'],
    objectFilter: {
      // Only invoices under $50,000
      amountCents: { lt: 5000000 },
    },
    partyFilter: {
      // Only known customers (not prospects or leads)
      type: 'customer',
    },
    budgetLimitCents: 50000, // $500/month LLM budget
    budgetPeriod: 'month' as const,
    maxDelegationDepth: 0, // Cannot delegate further
  };

  const constraints: GrantConstraints = {
    requireApproval: [
      // Escalation requires human approval
      'task.create',
    ],
    forbidden: [
      // Cannot initiate payments, refunds, or modify data
      'financial.payment.initiate',
      'financial.refund',
      'data.write',
      'data.delete',
      'agent.create',
      'agent.modify',
    ],
    disclosureRequired: true,
    auditLevel: 'full',
    rateLimit: {
      maxPerHour: 20,
      maxPerDay: 100,
    },
  };

  return {
    tenantId,
    grantorType: 'human',
    grantorId,
    granteeId,
    scope,
    constraints,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions for the collections agent
// ---------------------------------------------------------------------------

export const COLLECTIONS_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'send_collection_email',
      description: 'Send a collection/reminder email to a customer about an overdue invoice. The gateway will auto-append AI disclosure.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Customer email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body (plain text). Be professional and empathetic.' },
          invoiceId: { type: 'string', description: 'The invoice ID this email is about' },
          urgency: { type: 'string', enum: ['friendly', 'formal', 'escalation'], description: 'Tone of the email based on collection stage' },
        },
        required: ['to', 'subject', 'body', 'invoiceId', 'urgency'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_followup_task',
      description: 'Create a follow-up task for a human to review (e.g., when dispute detected or manual intervention needed)',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'What needs to be done and why' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          relatedObjectIds: { type: 'array', items: { type: 'string' }, description: 'IDs of related invoices/customers' },
        },
        required: ['title', 'description', 'priority'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_collection_note',
      description: 'Log a note about a collection interaction (e.g., customer promised to pay, needs special handling)',
      parameters: {
        type: 'object',
        properties: {
          invoiceId: { type: 'string', description: 'Related invoice ID' },
          note: { type: 'string', description: 'The note to log' },
          nextAction: { type: 'string', description: 'What should happen next' },
          nextActionDate: { type: 'string', description: 'When to follow up (ISO date)' },
        },
        required: ['invoiceId', 'note'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Domain instructions
// ---------------------------------------------------------------------------

const COLLECTIONS_INSTRUCTIONS = `You are an AR Collections Specialist. Your job is to follow up on overdue invoices and help customers pay on time.

APPROACH:
- Always check the customer's payment history and recent conversations BEFORE contacting them
- Adapt your tone to the relationship: long-time customers get empathetic outreach, new customers get professional-but-firm reminders
- Reference specific invoices, amounts, and dates — never be vague
- If a customer has mentioned payment difficulties in recent conversations, acknowledge this
- If you detect a dispute or complaint, do NOT send a collection email — create an escalation task instead

THINGS YOU MUST NEVER DO:
- Threaten legal action (this requires human authorization)
- Offer payment plans or discounts (this requires human authorization)
- Contact the same customer more than once per week about the same invoice
- Send collection emails outside business hours (9 AM - 5 PM in the customer's timezone)
- Discuss other customers' payment behavior`;

const COLLECTIONS_PLAYBOOK = `COLLECTION SEQUENCE:

Stage 1 — FRIENDLY REMINDER (3-7 days overdue):
- Subject: "Friendly reminder: Invoice [NUMBER] — [AMOUNT]"
- Tone: warm, professional, assume it was an oversight
- Include: invoice number, amount, due date, payment link
- Do NOT mention "overdue" or "past due"

Stage 2 — FORMAL NOTICE (14-21 days overdue):
- Subject: "Follow-up: Invoice [NUMBER] — [AMOUNT] (past due)"
- Tone: professional, direct, concerned
- Include: invoice details, payment history context, payment link
- Mention: "We want to resolve this promptly"

Stage 3 — ESCALATION (30+ days overdue OR dispute detected):
- Do NOT send an email
- Create a follow-up task with priority "high"
- Include: full context (invoice details, payment history, conversation history, your assessment)
- The human team will handle from here

SPECIAL CASES:
- Customer mentions "dispute" or "incorrect" → Stage 3 immediately, regardless of days overdue
- Customer mentions "cash flow" or "timing" → Note it, follow up in 7 days, do NOT escalate yet
- Partial payment received → Acknowledge, thank them, note remaining balance
- Multiple overdue invoices → Address them together in one email, total amount`;
