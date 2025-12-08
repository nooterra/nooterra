import { FastifyRequest } from "fastify";
import { PaymentRail, ReconcileReport, TopUpRequest, TopUpResult, VerifiedWebhookEvent } from "./payment-rail.js";
import { StripeRail } from "./payment-rail-stripe.js";

export class PaymentService {
  private rail: PaymentRail | null;

  constructor() {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    this.rail = stripeKey ? new StripeRail(stripeKey, process.env.STRIPE_WEBHOOK_SECRET) : null;
  }

  async requestTopUp(req: TopUpRequest): Promise<TopUpResult> {
    if (!this.rail) {
      throw new Error("payment_rail_not_configured");
    }
    return this.rail.createTopUpIntent(req);
  }

  async handleWebhook(request: FastifyRequest) {
    if (!this.rail) {
      throw new Error("payment_rail_not_configured");
    }
    const verified: VerifiedWebhookEvent = await this.rail.verifyWebhook(request);
    const traceId =
      (request.headers["x-request-id"] as string | undefined) ||
      (request.headers["x-correlation-id"] as string | undefined);
    return this.rail.applyWebhookEvent(verified, traceId);
  }

  async reconcile(since?: Date, until?: Date): Promise<ReconcileReport> {
    if (this.rail && typeof this.rail.reconcile === "function") {
      return this.rail.reconcile(since, until);
    }
    return { checkedSince: since, checkedUntil: until };
  }
}
