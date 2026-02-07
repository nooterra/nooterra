import { safeTruncate } from "./redaction.js";

export const MAGIC_LINK_RENDER_MODEL_ALLOWLIST_V1 = {
  schemaVersion: "MagicLinkRenderModelAllowlist.v1",
  version: 1,
  // Source of truth for fields that may appear in hosted outputs (HTML/PDF/CSV/support exports).
  invoiceClaim: {
    schemaVersion: { maxChars: 128 },
    tenantId: { maxChars: 500 },
    invoiceId: { maxChars: 500 },
    createdAt: { maxChars: 500 },
    currency: { maxChars: 16 },
    subtotalCents: { maxChars: 64 },
    totalCents: { maxChars: 64 },
    lineItems: {
      maxItems: 200,
      fields: {
        code: { maxChars: 200 },
        quantity: { maxChars: 64 },
        unitPriceCents: { maxChars: 64 },
        amountCents: { maxChars: 64 }
      }
    }
  },
  metering: { itemsCount: true, evidenceRefsCount: true },
  decision: {
    decision: { maxChars: 64 },
    decidedAt: { maxChars: 500 },
    decidedByEmail: { pii: true, maxChars: 320 }
  }
};

function isPlainObject(v) {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null));
}

export function buildPublicInvoiceClaimFromClaimJson(claimJson) {
  if (!isPlainObject(claimJson)) return null;
  return {
    schemaVersion: typeof claimJson.schemaVersion === "string" ? safeTruncate(claimJson.schemaVersion, { max: 128 }) : claimJson.schemaVersion ?? null,
    tenantId: typeof claimJson.tenantId === "string" ? safeTruncate(claimJson.tenantId, { max: 500 }) : null,
    invoiceId: typeof claimJson.invoiceId === "string" ? safeTruncate(claimJson.invoiceId, { max: 500 }) : null,
    createdAt: typeof claimJson.createdAt === "string" ? safeTruncate(claimJson.createdAt, { max: 500 }) : null,
    currency: typeof claimJson.currency === "string" ? safeTruncate(claimJson.currency, { max: 16 }) : null,
    subtotalCents: typeof claimJson.subtotalCents === "string" ? safeTruncate(claimJson.subtotalCents, { max: 64 }) : claimJson.subtotalCents ?? null,
    totalCents: typeof claimJson.totalCents === "string" ? safeTruncate(claimJson.totalCents, { max: 64 }) : null,
    lineItems: Array.isArray(claimJson.lineItems)
      ? claimJson.lineItems.slice(0, 200).map((it) => ({
          code: typeof it?.code === "string" ? safeTruncate(it.code, { max: 200 }) : null,
          quantity: typeof it?.quantity === "string" ? safeTruncate(it.quantity, { max: 64 }) : null,
          unitPriceCents: typeof it?.unitPriceCents === "string" ? safeTruncate(it.unitPriceCents, { max: 64 }) : null,
          amountCents: typeof it?.amountCents === "string" ? safeTruncate(it.amountCents, { max: 64 }) : null
        }))
      : []
  };
}

export function sampleRenderModelInvoiceClaimV1() {
  return {
    schemaVersion: "InvoiceClaim.v1",
    tenantId: "tenant_demo",
    invoiceId: "invoice_demo_1",
    createdAt: "2026-02-05T00:00:00.000Z",
    currency: "USD",
    subtotalCents: "10000",
    totalCents: "10000",
    lineItems: [{ code: "WORK_MINUTES", quantity: "10", unitPriceCents: "100", amountCents: "1000" }]
  };
}

