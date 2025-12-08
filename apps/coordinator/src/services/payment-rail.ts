import { FastifyRequest } from "fastify";

export interface Money {
  amount: number;
  currency: string;
}

export interface TopUpRequest {
  ownerDid: string;
  userId: number;
  amountCents: number;
  currency: string;
  metadata?: Record<string, any>;
}

export interface TopUpResult {
  providerRef: string;
  clientSecret?: string;
  redirectUrl?: string;
  status: "requires_action" | "pending" | "succeeded";
}

export interface VerifiedWebhookEvent {
  providerEventId: string;
  providerRef: string;
  amountCents: number;
  currency: string;
  status: "succeeded" | "failed" | "canceled" | "pending";
  userId?: number;
  metadata?: Record<string, any>;
}

export interface AppliedWebhookResult {
  paymentTransactionId: string;
  status: "succeeded" | "ignored" | "failed";
}

export interface ReconcileReport {
  checkedSince?: Date;
  checkedUntil?: Date;
  missingTransactions?: string[];
  creditedWithoutCharge?: string[];
  chargesWithoutCredit?: string[];
  amountMismatch?: string[];
}

export interface PaymentRail {
  createTopUpIntent(req: TopUpRequest): Promise<TopUpResult>;
  verifyWebhook(request: FastifyRequest): Promise<VerifiedWebhookEvent>;
  applyWebhookEvent(event: VerifiedWebhookEvent, traceId?: string): Promise<AppliedWebhookResult>;
  reconcile?(since?: Date, until?: Date): Promise<ReconcileReport>;
}
