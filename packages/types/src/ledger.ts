/**
 * @nooterra/types - Ledger Types
 *
 * Type definitions for the double-entry ledger and economics.
 */

/**
 * Currency types supported by the ledger
 */
export type Currency = "NCR" | "USD" | "USDC";

/**
 * Types of ledger entries
 */
export type LedgerEntryType =
  | "debit"      // Money out (payment for service)
  | "credit"    // Money in (earned from service)
  | "fee"       // Protocol fee
  | "deposit"   // Adding funds to account
  | "withdrawal" // Removing funds from account
  | "refund"    // Refund for failed task
  | "adjustment"; // Manual adjustment

/**
 * Account types in the ledger
 */
export type AccountType =
  | "user"      // End user account
  | "agent"     // Agent earnings account
  | "protocol"  // Protocol fee collection
  | "escrow";   // Held funds during workflow execution

/**
 * Ledger account
 */
export interface LedgerAccount {
  /** Unique account ID */
  id: string;
  /** Owner DID (user, agent, or system) */
  ownerDid: string;
  /** Account type */
  accountType: AccountType;
  /** Current balance in credits (1 credit = 0.001 USD) */
  balance: number;
  /** Currency */
  currency: Currency;
  /** Frozen balance (in escrow) */
  frozenBalance: number;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Individual ledger entry (one leg of a transaction)
 */
export interface LedgerEntry {
  /** Unique entry ID */
  id: string;
  /** Account this entry belongs to */
  accountId: string;
  /** Amount (positive for credit, negative for debit) */
  amount: number;
  /** Currency */
  currency: Currency;
  /** Entry type */
  entryType: LedgerEntryType;
  /** Batch ID (groups balanced entries) */
  batchId: string;
  /** Associated workflow ID */
  workflowId?: string;
  /** Associated node name */
  nodeName?: string;
  /** Description/reason */
  reason?: string;
  /** Additional metadata */
  meta?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: Date;
}

/**
 * Ledger event (legacy format, for backwards compatibility)
 */
export interface LedgerEvent {
  /** Unique event ID */
  id: string;
  /** Account ID */
  accountId: string;
  /** Workflow ID */
  workflowId?: string;
  /** Node name */
  nodeName?: string;
  /** Amount delta (positive or negative) */
  delta: number;
  /** Reason for the event */
  reason?: string;
  /** Additional metadata */
  meta?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: Date;
}

/**
 * Transaction batch (groups balanced entries)
 */
export interface LedgerBatch {
  /** Batch ID */
  id: string;
  /** Total amount (should sum to 0 for balanced batch) */
  totalAmount: number;
  /** Number of entries in batch */
  entryCount: number;
  /** Associated workflow ID */
  workflowId?: string;
  /** Description */
  description?: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Whether batch is balanced */
  isBalanced: boolean;
}

/**
 * Pricing configuration for a capability
 */
export interface CapabilityPricing {
  /** Capability ID */
  capabilityId: string;
  /** Base price in credits */
  basePriceCredits: number;
  /** Protocol fee in basis points (100 = 1%) */
  protocolFeeBps: number;
  /** Optional project-specific override */
  projectOverride?: {
    projectId: string;
    priceCredits: number;
    discountBps?: number;
  };
}

/**
 * Usage summary for a project/user
 */
export interface UsageSummary {
  /** Owner DID */
  ownerDid: string;
  /** Project ID (optional) */
  projectId?: string;
  /** Time period */
  period: {
    start: Date;
    end: Date;
  };
  /** Total credits spent */
  creditsSpent: number;
  /** Total workflows run */
  workflowCount: number;
  /** Breakdown by capability */
  byCapability: Record<string, {
    count: number;
    creditsSpent: number;
  }>;
  /** Breakdown by agent */
  byAgent: Record<string, {
    count: number;
    creditsSpent: number;
  }>;
}

/**
 * Agent earnings summary
 */
export interface AgentEarnings {
  /** Agent DID */
  agentDid: string;
  /** Time period */
  period: {
    start: Date;
    end: Date;
  };
  /** Gross earnings */
  grossCredits: number;
  /** Protocol fees paid */
  feesPaid: number;
  /** Net earnings */
  netCredits: number;
  /** Task count */
  taskCount: number;
  /** Breakdown by capability */
  byCapability: Record<string, {
    count: number;
    earnings: number;
  }>;
}
