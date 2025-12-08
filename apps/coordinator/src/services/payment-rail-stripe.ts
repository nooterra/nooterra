import { FastifyRequest } from "fastify";
import { pool } from "../db.js";
import {
  AppliedWebhookResult,
  PaymentRail,
  ReconcileReport,
  TopUpRequest,
  TopUpResult,
  VerifiedWebhookEvent,
} from "./payment-rail.js";

type StripeClient = any;

async function loadStripe(secret: string): Promise<StripeClient | null> {
  try {
    const stripeModule = await import("stripe");
    return new stripeModule.default(secret);
  } catch {
    return null;
  }
}

export class StripeRail implements PaymentRail {
  constructor(private secretKey: string, private webhookSecret?: string) {}

  async createTopUpIntent(req: TopUpRequest): Promise<TopUpResult> {
    const stripe = await loadStripe(this.secretKey);
    if (!stripe) {
      throw new Error("stripe_not_available");
    }
    const intent = await stripe.paymentIntents.create({
      amount: req.amountCents,
      currency: req.currency || "usd",
      metadata: {
        ownerDid: req.ownerDid,
        userId: req.userId?.toString(),
        ...req.metadata,
      },
    });
    return {
      providerRef: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status === "succeeded" ? "succeeded" : "pending",
    };
  }

  async verifyWebhook(request: FastifyRequest): Promise<VerifiedWebhookEvent> {
    const stripe = await loadStripe(this.secretKey);
    if (!stripe) {
      throw new Error("stripe_not_available");
    }
    const sig = request.headers["stripe-signature"] as string | undefined;
    if (!sig || !this.webhookSecret) {
      throw new Error("stripe_signature_missing");
    }

    const raw = (request as any).rawBody || (request as any).bodyRaw;
    if (!raw || !(raw instanceof Buffer)) {
      throw new Error("stripe_raw_body_missing");
    }

    const event = stripe.webhooks.constructEvent(raw, sig, this.webhookSecret);
    const type = event?.type;
    if (type !== "payment_intent.succeeded" && type !== "checkout.session.completed") {
      return {
        providerEventId: event?.id,
        providerRef: event?.data?.object?.id,
        amountCents: 0,
        currency: "usd",
        status: "ignored" as any,
      };
    }

    if (type === "payment_intent.succeeded") {
      const pi = event.data.object;
      return {
        providerEventId: event.id,
        providerRef: pi?.id,
        amountCents: pi?.amount_received,
        currency: pi?.currency || "usd",
        status: "succeeded",
        userId: pi?.metadata?.userId ? Number(pi.metadata.userId) : undefined,
        metadata: pi?.metadata,
      };
    }
    // checkout.session.completed
    const session = event.data.object;
    return {
      providerEventId: event.id,
      providerRef: session?.payment_intent || session?.id,
      amountCents: session?.amount_total,
      currency: session?.currency || "usd",
      status: "succeeded",
      userId: session?.metadata?.userId ? Number(session.metadata.userId) : undefined,
      metadata: session?.metadata,
    };
  }

  async applyWebhookEvent(event: VerifiedWebhookEvent, traceId?: string): Promise<AppliedWebhookResult> {
    if (event.status !== "succeeded") {
      return { paymentTransactionId: "", status: "ignored" };
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      const txRes = await client.query(
        `insert into payment_transactions (provider_event_id, provider_ref, payment_method, user_id, amount_cents, currency, credits_purchased, status, completed_at)
         values ($1,$2,'stripe',$3,$4,$5,$6,'completed', now())
         on conflict (provider_event_id) do update
            set status = 'completed',
                completed_at = coalesce(payment_transactions.completed_at, now()),
                amount_cents = coalesce(excluded.amount_cents, payment_transactions.amount_cents),
                currency = coalesce(excluded.currency, payment_transactions.currency),
                credits_purchased = coalesce(excluded.credits_purchased, payment_transactions.credits_purchased)
         returning id, user_id, credits_purchased, (xmax = 0) as inserted`,
        [
          event.providerEventId,
          event.providerRef,
          event.userId || null,
          event.amountCents || 0,
          event.currency || "usd",
          event.amountCents ? Math.round(event.amountCents / 100) : 0, // 1 NCR = $0.01 assumption
        ]
      );
      const row = txRes.rows[0];
      const creditedUserId = row?.user_id || event.userId;
      const credits = row?.credits_purchased || (event.amountCents ? Math.round(event.amountCents / 100) : 0);

      // If this was an existing provider_event_id (duplicate webhook), skip double crediting.
      if (creditedUserId && row?.inserted) {
        const ownerDid = `did:noot:user:${creditedUserId}`;
        await client.query(
          `insert into ledger_accounts (owner_did, balance)
             values ($1, $2)
           on conflict (owner_did) do update set balance = ledger_accounts.balance + excluded.balance`,
          [ownerDid, credits]
        );

        await client.query(
          `insert into ledger_events (owner_did, amount, currency, event_type, description, created_at)
             values ($1, $2, $3, 'payment_credit', $4, now())`,
          [ownerDid, credits, "credits", traceId ? `trace:${traceId}` : null]
        );
      }

      await client.query("commit");
      return { paymentTransactionId: row?.id, status: "succeeded" };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async reconcile(): Promise<ReconcileReport> {
    const stripe = await loadStripe(this.secretKey);
    if (!stripe) {
      return { checkedSince: undefined, checkedUntil: undefined, missingTransactions: [], creditedWithoutCharge: [], chargesWithoutCredit: [] };
    }

    const until = new Date();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const events: { eventId: string; providerRef: string; amountCents: number }[] = [];
    const createdFilter = { gte: Math.floor(since.getTime() / 1000), lte: Math.floor(until.getTime() / 1000) };

    for await (const evt of stripe.events.list({
      type: "payment_intent.succeeded",
      created: createdFilter,
      limit: 100,
    }).autoPagingEach((e: any) => e)) {
      const pi = evt?.data?.object;
      if (!pi?.id) continue;
      events.push({
        eventId: evt.id,
        providerRef: pi.id,
        amountCents: pi.amount_received ?? 0,
      });
    }

    const client = await pool.connect();
    try {
      const res = await client.query(
        `select provider_event_id, provider_ref, amount_cents 
           from payment_transactions 
          where payment_method = 'stripe' 
            and created_at between $1 and $2`,
        [since, until]
      );

      const byEvent = new Map<string, { providerRef: string; amount: number }>();
      const byRef = new Map<string, { eventId?: string; amount: number }>();
      res.rows.forEach((row: any) => {
        if (row.provider_event_id) {
          byEvent.set(row.provider_event_id, { providerRef: row.provider_ref, amount: Number(row.amount_cents) });
        }
        if (row.provider_ref) {
          byRef.set(row.provider_ref, { eventId: row.provider_event_id, amount: Number(row.amount_cents) });
        }
      });

      const chargesWithoutCredit: string[] = [];
      const creditedWithoutCharge: string[] = [];
      const amountMismatch: string[] = [];

      for (const evt of events) {
        const matched = byEvent.get(evt.eventId) || byRef.get(evt.providerRef);
        if (!matched) {
          chargesWithoutCredit.push(evt.providerRef);
        } else if (matched.amount !== evt.amountCents) {
          amountMismatch.push(`${evt.providerRef}:${matched.amount}->${evt.amountCents}`);
        }
      }

      for (const [ref] of byRef) {
        if (!events.find(e => e.providerRef === ref)) {
          creditedWithoutCharge.push(ref);
        }
      }

      return {
        checkedSince: since,
        checkedUntil: until,
        missingTransactions: [],
        creditedWithoutCharge,
        chargesWithoutCredit,
        amountMismatch,
      };
    } finally {
      client.release();
    }
  }
}
