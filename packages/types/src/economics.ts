/**
 * @nooterra/types - Economics Types
 *
 * Types for invoicing, disputes, and quotas.
 */

/**
 * Invoice for billing
 */
export interface Invoice {
  id: string;
  payerDid: string;
  payeeDid?: string;
  workflowId?: string;
  periodStart?: Date;
  periodEnd?: Date;
  subtotalCents: number;
  protocolFeeCents: number;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  pdfUrl?: string;
  stripeInvoiceId?: string;
  createdAt: Date;
  paidAt?: Date;
}

export type InvoiceStatus = "pending" | "paid" | "overdue" | "cancelled" | "refunded";

/**
 * Request to generate an invoice
 */
export interface GenerateInvoiceRequest {
  payerDid: string;
  workflowId?: string;
  periodStart?: Date;
  periodEnd?: Date;
}

/**
 * Dispute record
 */
export interface Dispute {
  id: string;
  workflowId?: string;
  nodeId?: string;
  complainantDid: string;
  respondentDid?: string;
  disputeType: DisputeType;
  description: string;
  evidence?: Record<string, unknown>;
  status: DisputeStatus;
  resolution?: string;
  resolvedBy?: string;
  creditsRefunded?: number;
  createdAt: Date;
  resolvedAt?: Date;
}

export type DisputeType =
  | "quality"
  | "timeout"
  | "incorrect_output"
  | "overcharge"
  | "fraud"
  | "other";

export type DisputeStatus =
  | "open"
  | "under_review"
  | "resolved_complainant"
  | "resolved_respondent"
  | "resolved_split"
  | "dismissed";

/**
 * Request to open a dispute
 */
export interface OpenDisputeRequest {
  workflowId?: string;
  nodeId?: string;
  respondentDid?: string;
  disputeType: DisputeType;
  description: string;
  evidence?: Record<string, unknown>;
}

/**
 * Request to resolve a dispute
 */
export interface ResolveDisputeRequest {
  resolution: string;
  status: DisputeStatus;
  creditsRefunded?: number;
}

/**
 * Usage quota configuration
 */
export interface UsageQuota {
  id: number;
  ownerDid: string;
  maxWorkflowsPerDay?: number;
  maxConcurrentWorkflows?: number;
  maxSpendPerDayCents?: number;
  currentDailyWorkflows: number;
  currentDailySpendCents: number;
  quotaResetAt: Date;
  createdAt: Date;
}

/**
 * Quota check result
 */
export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  currentUsage: {
    dailyWorkflows: number;
    dailySpendCents: number;
    concurrentWorkflows: number;
  };
  limits: {
    maxWorkflowsPerDay?: number;
    maxConcurrentWorkflows?: number;
    maxSpendPerDayCents?: number;
  };
  resetsAt: Date;
}

/**
 * Settlement request for real currency
 */
export interface SettlementRequest {
  agentDid: string;
  amountCents: number;
  currency: string;
  destinationType: "crypto" | "bank" | "stripe";
  destination: {
    address?: string;
    chainId?: number;
    accountId?: string;
  };
}

/**
 * Settlement result
 */
export interface SettlementResult {
  id: string;
  agentDid: string;
  amountCents: number;
  currency: string;
  status: "pending" | "processing" | "completed" | "failed";
  transactionId?: string;
  createdAt: Date;
  completedAt?: Date;
}
