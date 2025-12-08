import { describe, expect, it, beforeEach, vi } from "vitest";
import { StripeRail } from "./payment-rail-stripe.js";
import { pool } from "../db.js";

// Mock Stripe SDK so we can control webhook verification behaviour
vi.mock("stripe", () => {
  class StripeMock {
    webhooks = {
      constructEvent: (raw: Buffer, sig: string, secret: string) => {
        if (sig !== "good" || secret !== "whsec_test") {
          throw new Error("bad_sig");
        }
        return {
          id: "evt_123",
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: "pi_123",
              amount_received: 4200,
              currency: "usd",
              metadata: { userId: "12" },
            },
          },
        };
      },
    };
    paymentIntents = { create: vi.fn() };
    constructor(public key: string) {}
  }
  return { default: StripeMock };
});

describe("StripeRail", () => {
  let rail: StripeRail;

  beforeEach(() => {
    rail = new StripeRail("sk_test", "whsec_test");
  });

  it("rejects webhook without raw body (signature check fails safely)", async () => {
    const req: any = {
      headers: { "stripe-signature": "good" },
      rawBody: undefined,
    };
    await expect(rail.verifyWebhook(req)).rejects.toThrow("stripe_raw_body_missing");
  });

  it("parses a valid payment_intent.succeeded webhook", async () => {
    const req: any = {
      headers: { "stripe-signature": "good" },
      rawBody: Buffer.from("body"),
    };
    const event = await rail.verifyWebhook(req);
    expect(event).toMatchObject({
      providerEventId: "evt_123",
      providerRef: "pi_123",
      amountCents: 4200,
      currency: "usd",
      status: "succeeded",
      userId: 12,
    });
  });

  it("is idempotent for duplicate provider_event_id", async () => {
    const paymentRows = new Map<string, { id: string; user_id: number; credits_purchased: number; inserted: boolean }>();
    const ledger = new Map<string, number>();

    (pool.connect as any).mockResolvedValue({
      query: vi.fn(async (sql: string, params: any[]) => {
        const text = sql.toLowerCase();
        if (text.startsWith("begin") || text.startsWith("commit") || text.startsWith("rollback")) {
          return { rows: [] };
        }

        if (text.includes("insert into payment_transactions")) {
          const providerEventId = params[0];
          if (paymentRows.has(providerEventId)) {
            const existing = paymentRows.get(providerEventId)!;
            return { rows: [{ ...existing, inserted: false }] };
          }
          const row = {
            id: `tx-${paymentRows.size + 1}`,
            user_id: params[2],
            credits_purchased: params[5],
            inserted: true,
          };
          paymentRows.set(providerEventId, row);
          return { rows: [row] };
        }

        if (text.includes("insert into ledger_accounts")) {
          const ownerDid = params[0];
          const balance = Number(params[1]);
          const current = ledger.get(ownerDid) || 0;
          ledger.set(ownerDid, current + balance);
          return { rows: [] };
        }

        if (text.includes("insert into ledger_events")) {
          return { rows: [] };
        }

        throw new Error(`Unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    });

    const event = {
      providerEventId: "evt_dup",
      providerRef: "pi_dup",
      amountCents: 5000,
      currency: "usd",
      status: "succeeded" as const,
      userId: 7,
    };

    await rail.applyWebhookEvent(event, "trace-123");
    await rail.applyWebhookEvent(event, "trace-123");

    const balance = ledger.get("did:noot:user:7") || 0;
    expect(balance).toBe(50); // 5000 cents → 50 credits, only once
    expect(paymentRows.size).toBe(1);
  });
});
