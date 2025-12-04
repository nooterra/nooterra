/**
 * @nooterra/types - Identity Types
 *
 * Types for agent inheritance, recovery, and naming.
 */

/**
 * Agent inheritance configuration
 */
export interface AgentInheritance {
  id: number;
  agentDid: string;
  /** Wallet/DID that can recover the agent if keys are lost */
  recoveryAddress?: string;
  /** Agent DID that inherits tasks if this agent dies */
  heirDid?: string;
  /** When this agent's registration expires */
  expiresAt?: Date;
  /** Hours of inactivity before dead man switch triggers */
  deadManSwitchHours?: number;
  /** Last activity timestamp for dead man switch */
  lastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Request to set up agent inheritance
 */
export interface SetInheritanceRequest {
  recoveryAddress?: string;
  heirDid?: string;
  expiresAt?: Date;
  deadManSwitchHours?: number;
}

/**
 * Agent name registration (ENS-style)
 */
export interface AgentName {
  id: number;
  /** Human-readable name (e.g., "summarizer.noot") */
  name: string;
  /** Agent DID this name points to */
  agentDid: string;
  /** Owner who can update the name */
  ownerDid?: string;
  /** When the name registration expires */
  expiresAt?: Date;
  createdAt: Date;
}

/**
 * Request to register an agent name
 */
export interface RegisterNameRequest {
  name: string;
  agentDid: string;
  durationMonths?: number;
}

/**
 * Recovery request when keys are lost
 */
export interface RecoveryRequest {
  agentDid: string;
  recoveryAddress: string;
  newPublicKey: string;
  /** Signature from recovery address proving ownership */
  recoveryProof: string;
}

/**
 * Dead man switch trigger result
 */
export interface DeadManSwitchResult {
  agentDid: string;
  heirDid?: string;
  tasksTransferred: number;
  triggeredAt: Date;
}
