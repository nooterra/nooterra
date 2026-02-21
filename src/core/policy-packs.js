export const POLICY_PACK_SCHEMA_VERSION = "SettldPolicyPack.v1";
export const POLICY_PACK_TEMPLATE_CATALOG_VERSION = "SettldPolicyPackTemplateCatalog.v1";

const STARTER_POLICY_PACKS = Object.freeze([
  Object.freeze({
    packId: "engineering-spend",
    metadata: Object.freeze({
      name: "Engineering Spend Guardrails",
      vertical: "engineering",
      description: "Balanced defaults for software and AI tool spend with tiered approvals."
    }),
    policyDefaults: Object.freeze({
      currency: "USD",
      limits: Object.freeze({
        perRequestUsdCents: 300_000,
        monthlyUsdCents: 1_500_000
      }),
      allowlists: Object.freeze({
        providers: Object.freeze(["anthropic", "aws", "openai"]),
        tools: Object.freeze(["ci.compute", "llm.inference", "observability.logs"])
      }),
      approvals: Object.freeze([
        Object.freeze({ tierId: "auto", maxAmountUsdCents: 50_000, requiredApprovers: 0, approverRole: "none" }),
        Object.freeze({ tierId: "manager", maxAmountUsdCents: 150_000, requiredApprovers: 1, approverRole: "engineering_manager" }),
        Object.freeze({ tierId: "director", maxAmountUsdCents: 300_000, requiredApprovers: 2, approverRole: "engineering_director" })
      ]),
      enforcement: Object.freeze({
        enforceProviderAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      }),
      disputeDefaults: Object.freeze({
        responseWindowHours: 72,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "policy_trace", "receipt"])
      })
    })
  }),
  Object.freeze({
    packId: "procurement-enterprise",
    metadata: Object.freeze({
      name: "Procurement Enterprise",
      vertical: "procurement",
      description: "Conservative purchasing controls for enterprise procurement teams."
    }),
    policyDefaults: Object.freeze({
      currency: "USD",
      limits: Object.freeze({
        perRequestUsdCents: 500_000,
        monthlyUsdCents: 4_000_000
      }),
      allowlists: Object.freeze({
        providers: Object.freeze(["aws", "azure", "gcp", "stripe"]),
        tools: Object.freeze(["data.warehouse", "erp.connector", "invoice.automation"])
      }),
      approvals: Object.freeze([
        Object.freeze({ tierId: "analyst", maxAmountUsdCents: 100_000, requiredApprovers: 1, approverRole: "procurement_analyst" }),
        Object.freeze({ tierId: "manager", maxAmountUsdCents: 300_000, requiredApprovers: 2, approverRole: "procurement_manager" }),
        Object.freeze({ tierId: "director", maxAmountUsdCents: 500_000, requiredApprovers: 3, approverRole: "finance_director" })
      ]),
      enforcement: Object.freeze({
        enforceProviderAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      }),
      disputeDefaults: Object.freeze({
        responseWindowHours: 96,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "purchase_order", "receipt", "vendor_contract"])
      })
    })
  }),
  Object.freeze({
    packId: "data-api-buyer",
    metadata: Object.freeze({
      name: "Data API Buyer",
      vertical: "data",
      description: "Usage-metered API and data acquisition controls for product teams."
    }),
    policyDefaults: Object.freeze({
      currency: "USD",
      limits: Object.freeze({
        perRequestUsdCents: 120_000,
        monthlyUsdCents: 900_000
      }),
      allowlists: Object.freeze({
        providers: Object.freeze(["exa", "openai", "serpapi"]),
        tools: Object.freeze(["data.extract", "search.query", "summarize.batch"])
      }),
      approvals: Object.freeze([
        Object.freeze({ tierId: "auto", maxAmountUsdCents: 25_000, requiredApprovers: 0, approverRole: "none" }),
        Object.freeze({ tierId: "owner", maxAmountUsdCents: 80_000, requiredApprovers: 1, approverRole: "data_product_owner" }),
        Object.freeze({ tierId: "exec", maxAmountUsdCents: 120_000, requiredApprovers: 2, approverRole: "business_owner" })
      ]),
      enforcement: Object.freeze({
        enforceProviderAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      }),
      disputeDefaults: Object.freeze({
        responseWindowHours: 48,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "receipt", "usage_export"])
      })
    })
  }),
  Object.freeze({
    packId: "support-automation",
    metadata: Object.freeze({
      name: "Support Automation",
      vertical: "support",
      description: "Fast-path support tooling policy with strict monthly caps and receipt evidence."
    }),
    policyDefaults: Object.freeze({
      currency: "USD",
      limits: Object.freeze({
        perRequestUsdCents: 40_000,
        monthlyUsdCents: 400_000
      }),
      allowlists: Object.freeze({
        providers: Object.freeze(["openai", "zendesk"]),
        tools: Object.freeze(["ticket.triage", "response.draft", "knowledge.search"])
      }),
      approvals: Object.freeze([
        Object.freeze({ tierId: "auto", maxAmountUsdCents: 10_000, requiredApprovers: 0, approverRole: "none" }),
        Object.freeze({ tierId: "lead", maxAmountUsdCents: 25_000, requiredApprovers: 1, approverRole: "support_lead" }),
        Object.freeze({ tierId: "director", maxAmountUsdCents: 40_000, requiredApprovers: 2, approverRole: "support_director" })
      ]),
      enforcement: Object.freeze({
        enforceProviderAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      }),
      disputeDefaults: Object.freeze({
        responseWindowHours: 48,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "receipt", "ticket_export"])
      })
    })
  }),
  Object.freeze({
    packId: "finance-controls",
    metadata: Object.freeze({
      name: "Finance Controls",
      vertical: "finance",
      description: "Strict finance pack for settlement-sensitive workflows and audit controls."
    }),
    policyDefaults: Object.freeze({
      currency: "USD",
      limits: Object.freeze({
        perRequestUsdCents: 750_000,
        monthlyUsdCents: 7_500_000
      }),
      allowlists: Object.freeze({
        providers: Object.freeze(["circle", "stripe", "treasury"]),
        tools: Object.freeze(["ledger.posting", "payout.batch", "reconciliation.run"])
      }),
      approvals: Object.freeze([
        Object.freeze({ tierId: "analyst", maxAmountUsdCents: 150_000, requiredApprovers: 1, approverRole: "finance_analyst" }),
        Object.freeze({ tierId: "controller", maxAmountUsdCents: 400_000, requiredApprovers: 2, approverRole: "finance_controller" }),
        Object.freeze({ tierId: "cfo", maxAmountUsdCents: 750_000, requiredApprovers: 3, approverRole: "cfo" })
      ]),
      enforcement: Object.freeze({
        enforceProviderAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      }),
      disputeDefaults: Object.freeze({
        responseWindowHours: 120,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "receipt", "journal_export", "reconcile_report"])
      })
    })
  })
]);

function deepClone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

export function listPolicyPackTemplates() {
  return STARTER_POLICY_PACKS.map((pack) => deepClone(pack));
}

export function getPolicyPackTemplate({ packId } = {}) {
  const id = String(packId ?? "").trim();
  if (!id) throw new TypeError("packId is required");
  const pack = STARTER_POLICY_PACKS.find((item) => item.packId === id) ?? null;
  return pack ? deepClone(pack) : null;
}

export function createStarterPolicyPack({ packId } = {}) {
  const template = getPolicyPackTemplate({ packId });
  if (!template) return null;
  return {
    schemaVersion: POLICY_PACK_SCHEMA_VERSION,
    packId: template.packId,
    metadata: template.metadata,
    policy: template.policyDefaults
  };
}
