export const PROFILE_SCHEMA_VERSION = "NooterraProfile.v1";
export const PROFILE_TEMPLATE_CATALOG_VERSION = "NooterraProfileTemplateCatalog.v1";

const STARTER_PROFILES = Object.freeze([
  Object.freeze({
    profileId: "engineering-spend",
    metadata: Object.freeze({
      name: "Engineering Spend",
      vertical: "engineering",
      description: "Policy defaults for software/tooling spend with tiered approvals."
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
      approvalTiers: Object.freeze([
        Object.freeze({ tierId: "auto", maxAmountUsdCents: 50_000, requiredApprovers: 0, approverRole: "none" }),
        Object.freeze({ tierId: "manager", maxAmountUsdCents: 150_000, requiredApprovers: 1, approverRole: "engineering_manager" }),
        Object.freeze({ tierId: "director", maxAmountUsdCents: 300_000, requiredApprovers: 2, approverRole: "engineering_director" })
      ]),
      disputeDefaults: Object.freeze({
        responseWindowHours: 72,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "policy_trace", "receipt"])
      }),
      compliance: Object.freeze({
        enforceVendorAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      })
    })
  }),
  Object.freeze({
    profileId: "procurement",
    metadata: Object.freeze({
      name: "Procurement",
      vertical: "procurement",
      description: "Conservative enterprise purchasing profile with stricter approvals."
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
      approvalTiers: Object.freeze([
        Object.freeze({ tierId: "analyst", maxAmountUsdCents: 100_000, requiredApprovers: 1, approverRole: "procurement_analyst" }),
        Object.freeze({ tierId: "manager", maxAmountUsdCents: 300_000, requiredApprovers: 2, approverRole: "procurement_manager" }),
        Object.freeze({ tierId: "director", maxAmountUsdCents: 500_000, requiredApprovers: 3, approverRole: "finance_director" })
      ]),
      disputeDefaults: Object.freeze({
        responseWindowHours: 96,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "purchase_order", "receipt", "vendor_contract"])
      }),
      compliance: Object.freeze({
        enforceVendorAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      })
    })
  }),
  Object.freeze({
    profileId: "data-api-buyer",
    metadata: Object.freeze({
      name: "Data API Buyer",
      vertical: "data",
      description: "Profile defaults for teams buying usage-metered data/API calls."
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
      approvalTiers: Object.freeze([
        Object.freeze({ tierId: "auto", maxAmountUsdCents: 25_000, requiredApprovers: 0, approverRole: "none" }),
        Object.freeze({ tierId: "owner", maxAmountUsdCents: 80_000, requiredApprovers: 1, approverRole: "data_product_owner" }),
        Object.freeze({ tierId: "exec", maxAmountUsdCents: 120_000, requiredApprovers: 2, approverRole: "business_owner" })
      ]),
      disputeDefaults: Object.freeze({
        responseWindowHours: 48,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "receipt", "usage_export"])
      }),
      compliance: Object.freeze({
        enforceVendorAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      })
    })
  }),
  Object.freeze({
    profileId: "support-automation",
    metadata: Object.freeze({
      name: "Support Automation",
      vertical: "support",
      description: "Profile defaults for customer support agents with strict low-ticket spend controls."
    }),
    policyDefaults: Object.freeze({
      currency: "USD",
      limits: Object.freeze({
        perRequestUsdCents: 40_000,
        monthlyUsdCents: 450_000
      }),
      allowlists: Object.freeze({
        providers: Object.freeze(["openai", "twilio", "zendesk"]),
        tools: Object.freeze(["ticket.reply", "knowledge.search", "ivr.call"])
      }),
      approvalTiers: Object.freeze([
        Object.freeze({ tierId: "auto", maxAmountUsdCents: 10_000, requiredApprovers: 0, approverRole: "none" }),
        Object.freeze({ tierId: "lead", maxAmountUsdCents: 25_000, requiredApprovers: 1, approverRole: "support_lead" }),
        Object.freeze({ tierId: "manager", maxAmountUsdCents: 40_000, requiredApprovers: 2, approverRole: "support_manager" })
      ]),
      disputeDefaults: Object.freeze({
        responseWindowHours: 48,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["ticket_id", "approval_log", "receipt"])
      }),
      compliance: Object.freeze({
        enforceVendorAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      })
    })
  }),
  Object.freeze({
    profileId: "finance-controls",
    metadata: Object.freeze({
      name: "Finance Controls",
      vertical: "finance",
      description: "Profile defaults for finance workflows where every payment path must stay tightly governed."
    }),
    policyDefaults: Object.freeze({
      currency: "USD",
      limits: Object.freeze({
        perRequestUsdCents: 800_000,
        monthlyUsdCents: 5_000_000
      }),
      allowlists: Object.freeze({
        providers: Object.freeze(["circle", "stripe", "wise"]),
        tools: Object.freeze(["invoice.pay", "ledger.reconcile", "dispute.resolve"])
      }),
      approvalTiers: Object.freeze([
        Object.freeze({ tierId: "controller", maxAmountUsdCents: 150_000, requiredApprovers: 1, approverRole: "finance_controller" }),
        Object.freeze({ tierId: "director", maxAmountUsdCents: 400_000, requiredApprovers: 2, approverRole: "finance_director" }),
        Object.freeze({ tierId: "cfo", maxAmountUsdCents: 800_000, requiredApprovers: 3, approverRole: "chief_financial_officer" })
      ]),
      disputeDefaults: Object.freeze({
        responseWindowHours: 120,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "receipt", "payment_trace", "counterparty_statement"])
      }),
      compliance: Object.freeze({
        enforceVendorAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      })
    })
  }),
  Object.freeze({
    profileId: "growth-marketing",
    metadata: Object.freeze({
      name: "Growth Marketing",
      vertical: "marketing",
      description: "Profile defaults for ad and campaign spending with bounded experimentation budgets."
    }),
    policyDefaults: Object.freeze({
      currency: "USD",
      limits: Object.freeze({
        perRequestUsdCents: 180_000,
        monthlyUsdCents: 1_200_000
      }),
      allowlists: Object.freeze({
        providers: Object.freeze(["meta", "google_ads", "x_ads"]),
        tools: Object.freeze(["campaign.launch", "creative.generate", "audience.sync"])
      }),
      approvalTiers: Object.freeze([
        Object.freeze({ tierId: "auto", maxAmountUsdCents: 50_000, requiredApprovers: 0, approverRole: "none" }),
        Object.freeze({ tierId: "manager", maxAmountUsdCents: 120_000, requiredApprovers: 1, approverRole: "growth_manager" }),
        Object.freeze({ tierId: "director", maxAmountUsdCents: 180_000, requiredApprovers: 2, approverRole: "marketing_director" })
      ]),
      disputeDefaults: Object.freeze({
        responseWindowHours: 72,
        autoOpenIfReceiptMissing: true,
        evidenceChecklist: Object.freeze(["approval_log", "campaign_id", "receipt", "spend_export"])
      }),
      compliance: Object.freeze({
        enforceVendorAllowlist: true,
        requireReceiptSignature: true,
        requireToolManifestHash: true,
        allowUnknownToolVersion: false
      })
    })
  })
]);

function deepClone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

export function listProfileTemplates() {
  return STARTER_PROFILES.map((profile) => deepClone(profile));
}

export function getProfileTemplate({ profileId } = {}) {
  const id = String(profileId ?? "").trim();
  if (!id) throw new TypeError("profileId is required");
  const profile = STARTER_PROFILES.find((item) => item.profileId === id) ?? null;
  return profile ? deepClone(profile) : null;
}

export function createStarterProfile({ profileId } = {}) {
  const template = getProfileTemplate({ profileId });
  if (!template) return null;
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    profileId: template.profileId,
    metadata: template.metadata,
    policy: template.policyDefaults
  };
}
