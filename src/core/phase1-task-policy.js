const PHASE1_TASK_POLICY_SCHEMA_VERSION = "Phase1TaskPolicy.v1";
const PHASE1_MANAGED_WORKER_METADATA_SCHEMA_VERSION = "Phase1ManagedWorkerMetadata.v1";
export const PHASE1_EXECUTION_ADAPTER_SCHEMA_VERSION = "Phase1ExecutionAdapter.v1";

export const PHASE1_TASK_POLICY_STATUS = Object.freeze({
  SUPPORTED: "supported",
  BLOCKED: "blocked",
  UNKNOWN: "unknown"
});

export const PHASE1_TASK_POLICY_REASON_CODE = Object.freeze({
  SUPPORTED_CATEGORY: "PHASE1_SUPPORTED_CATEGORY",
  BLOCKED_CATEGORY: "PHASE1_BLOCKED_CATEGORY",
  CATEGORY_NOT_SUPPORTED: "PHASE1_CATEGORY_NOT_SUPPORTED"
});

export const PHASE1_SUPPORTED_TASK_CATEGORIES = Object.freeze([
  Object.freeze({
    categoryId: "comparison_selection",
    label: "Comparison and selection",
    summary: "Compare options, narrow choices, and recommend the best fit within constraints.",
    signals: Object.freeze(["compare", "comparison", "best option", "best one", "recommend", "options", "tradeoffs"]),
    completionContract: Object.freeze({
      summary: "Done when the network returns a ranked short list, a recommended choice, and the reasons behind it.",
      successStates: Object.freeze(["recommendation_delivered", "recommendation_delivered_with_operator_note"]),
      unresolvedStates: Object.freeze(["needs_user_constraint", "needs_operator_review"]),
      evidenceRequirements: Object.freeze(["option_summary", "source_links", "decision_rationale"]),
      proofSummary: "A comparison summary, source trail, and final recommendation."
    })
  }),
  Object.freeze({
    categoryId: "purchases_under_cap",
    label: "Purchases under a cap",
    summary: "Source and buy products under an explicit budget or merchant constraint.",
    signals: Object.freeze(["buy", "order", "purchase", "replacement", "under $", "under ", "budget", "charger", "chair", "laptop"]),
    completionContract: Object.freeze({
      summary: "Done when the item is selected inside the cap, purchased, and the receipt trail is attached.",
      successStates: Object.freeze(["purchase_confirmed", "purchase_declined_by_user", "purchase_not_possible_within_cap"]),
      unresolvedStates: Object.freeze(["needs_payment_confirmation", "awaiting_vendor_response"]),
      evidenceRequirements: Object.freeze(["receipt", "merchant_confirmation", "price_breakdown"]),
      proofSummary: "An item decision record, purchase receipt, and merchant confirmation."
    })
  }),
  Object.freeze({
    categoryId: "scheduling_booking",
    label: "Scheduling and booking",
    summary: "Coordinate appointments, reservations, and calendar-bound bookings.",
    signals: Object.freeze(["appointment", "schedule", "reschedule", "calendar", "reservation", "dentist", "book"]),
    completionContract: Object.freeze({
      summary: "Done when a bounded time slot is booked or the blocking constraint is made explicit.",
      successStates: Object.freeze(["booking_confirmed", "booking_declined_by_user", "no_acceptable_slot_found"]),
      unresolvedStates: Object.freeze(["needs_calendar_access", "awaiting_counterparty_reply"]),
      evidenceRequirements: Object.freeze(["booking_confirmation", "calendar_hold_or_event", "availability_trace"]),
      proofSummary: "A booking confirmation or a documented reason no valid slot could be secured."
    })
  }),
  Object.freeze({
    categoryId: "subscriptions_cancellations",
    label: "Subscriptions and cancellations",
    summary: "Cancel or change plans, memberships, and recurring services.",
    signals: Object.freeze(["cancel", "membership", "subscription", "gym", "plan change", "unused", "internet bill"]),
    completionContract: Object.freeze({
      summary: "Done when the plan change or cancellation is confirmed, denied with reason, or waiting on user action.",
      successStates: Object.freeze(["cancellation_confirmed", "plan_change_confirmed", "cancellation_denied_with_reason"]),
      unresolvedStates: Object.freeze(["needs_account_access", "awaiting_provider_confirmation"]),
      evidenceRequirements: Object.freeze(["cancellation_number", "provider_confirmation", "billing_change_summary"]),
      proofSummary: "A cancellation number or provider confirmation with the new billing state."
    })
  }),
  Object.freeze({
    categoryId: "support_follow_up",
    label: "Support and refund follow-up",
    summary: "Chase support outcomes, refunds, claims, and unresolved service requests.",
    signals: Object.freeze(["refund", "claim", "support", "ticket", "follow up", "never arrived", "escalate", "chargeback"]),
    completionContract: Object.freeze({
      summary: "Done when the issue is resolved, escalated with context, or blocked on external response with the follow-up trail intact.",
      successStates: Object.freeze(["issue_resolved", "refund_confirmed", "support_escalated"]),
      unresolvedStates: Object.freeze(["awaiting_external_response", "needs_user_document", "operator_takeover_required"]),
      evidenceRequirements: Object.freeze(["ticket_reference", "message_log", "resolution_summary"]),
      proofSummary: "A support timeline with ticket references, outbound messages, and the final resolution state."
    })
  }),
  Object.freeze({
    categoryId: "travel_logistics",
    label: "Travel and logistics",
    summary: "Research and book bounded travel, lodging, and itinerary elements.",
    signals: Object.freeze(["trip", "travel", "flight", "hotel", "airport", "parking", "itinerary", "refundable hotel"]),
    completionContract: Object.freeze({
      summary: "Done when the requested travel component is booked within constraints or the best alternatives are returned with proof.",
      successStates: Object.freeze(["travel_component_booked", "travel_option_selected", "travel_not_booked_with_reason"]),
      unresolvedStates: Object.freeze(["needs_identity_document", "awaiting_supplier_confirmation"]),
      evidenceRequirements: Object.freeze(["booking_confirmation", "itinerary_summary", "price_trace"]),
      proofSummary: "A booking confirmation or itinerary recommendation backed by price and availability evidence."
    })
  }),
  Object.freeze({
    categoryId: "document_admin_packaging",
    label: "Document gathering and admin packaging",
    summary: "Collect documents, package routine admin work, and prepare submissions.",
    signals: Object.freeze(["documents", "paperwork", "form", "forms", "application", "package", "submit", "ticket admin"]),
    completionContract: Object.freeze({
      summary: "Done when the required materials are assembled into a submission-ready packet or the missing inputs are explicit.",
      successStates: Object.freeze(["packet_ready", "submission_prepared", "missing_materials_identified"]),
      unresolvedStates: Object.freeze(["needs_user_document", "awaiting_third_party_record"]),
      evidenceRequirements: Object.freeze(["document_manifest", "packet_copy", "submission_or_handoff_note"]),
      proofSummary: "A manifest of gathered materials plus the final packet or handoff artifact."
    })
  })
]);

export const PHASE1_MANAGED_SPECIALIST_PROFILES = Object.freeze([
  Object.freeze({
    id: "comparison_concierge",
    title: "Comparison Concierge",
    body: "Finds evidence, compares options, and narrows the field before money or booking authority is used.",
    displayName: "Comparison Concierge",
    description: "A managed specialist for comparison, recommendation, and price or provider shortlisting.",
    capabilities: Object.freeze(["capability://research.analysis", "capability://knowledge.synthesis"]),
    priceAmountCents: 320,
    priceCurrency: "USD",
    priceUnit: "task",
    runtimeName: "nooterra",
    tags: Object.freeze(["phase1", "comparison", "consumer"]),
    familyIds: Object.freeze(["comparison_selection", "purchases_under_cap", "travel_logistics"])
  }),
  Object.freeze({
    id: "purchase_runner",
    title: "Purchase Runner",
    body: "Executes bounded purchases under an approved cap and returns the receipt trail.",
    displayName: "Purchase Runner",
    description: "A managed specialist for consumer purchases that must stay inside a strict spend envelope.",
    capabilities: Object.freeze(["capability://consumer.purchase.execute"]),
    priceAmountCents: 540,
    priceCurrency: "USD",
    priceUnit: "task",
    runtimeName: "nooterra",
    tags: Object.freeze(["phase1", "purchase", "consumer"]),
    familyIds: Object.freeze(["purchases_under_cap"]),
    executionAdapter: Object.freeze({
      schemaVersion: PHASE1_EXECUTION_ADAPTER_SCHEMA_VERSION,
      adapterId: "delegated_account_session_checkout",
      mode: "delegated_account_session",
      requiresDelegatedAccountSession: true,
      supportedSessionModes: Object.freeze(["browser_delegated", "approval_at_boundary", "operator_supervised"]),
      requiredRunFields: Object.freeze(["account_session_ref", "provider_key", "site_key", "execution_mode"]),
      merchantScope: "consumer_commerce",
      reviewPolicy: "require user-approved spend envelope or boundary confirmation before final checkout"
    })
  }),
  Object.freeze({
    id: "booking_concierge",
    title: "Booking Concierge",
    body: "Coordinates calendars, reservations, and travel bookings within the approved constraints.",
    displayName: "Booking Concierge",
    description: "A managed specialist for appointments, reservations, and bounded travel execution.",
    capabilities: Object.freeze(["capability://consumer.scheduling.booking", "capability://travel.booking@v2"]),
    priceAmountCents: 480,
    priceCurrency: "USD",
    priceUnit: "task",
    runtimeName: "nooterra",
    tags: Object.freeze(["phase1", "booking", "travel"]),
    familyIds: Object.freeze(["scheduling_booking", "travel_logistics"]),
    executionAdapter: Object.freeze({
      schemaVersion: PHASE1_EXECUTION_ADAPTER_SCHEMA_VERSION,
      adapterId: "delegated_account_session_booking",
      mode: "delegated_account_session",
      requiresDelegatedAccountSession: true,
      supportedSessionModes: Object.freeze(["browser_delegated", "approval_at_boundary", "operator_supervised"]),
      requiredRunFields: Object.freeze(["account_session_ref", "provider_key", "site_key", "execution_mode"]),
      merchantScope: "booking_travel",
      reviewPolicy: "allow autonomous slot selection inside approved constraints, but keep final booking bounded by the stored review mode"
    })
  }),
  Object.freeze({
    id: "account_admin",
    title: "Account Admin",
    body: "Handles subscription changes, cancellations, and routine account administration with confirmation trails.",
    displayName: "Account Admin",
    description: "A managed specialist for memberships, recurring services, and account updates.",
    capabilities: Object.freeze(["capability://consumer.subscription.manage"]),
    priceAmountCents: 420,
    priceCurrency: "USD",
    priceUnit: "task",
    runtimeName: "nooterra",
    tags: Object.freeze(["phase1", "subscription", "admin"]),
    familyIds: Object.freeze(["subscriptions_cancellations"]),
    executionAdapter: Object.freeze({
      schemaVersion: PHASE1_EXECUTION_ADAPTER_SCHEMA_VERSION,
      adapterId: "delegated_account_session_account_admin",
      mode: "delegated_account_session",
      requiresDelegatedAccountSession: true,
      supportedSessionModes: Object.freeze(["browser_delegated", "operator_supervised"]),
      requiredRunFields: Object.freeze(["account_session_ref", "provider_key", "site_key", "execution_mode"]),
      merchantScope: "consumer_account_admin",
      reviewPolicy: "keep operator or user review at the irreversible account-change boundary"
    })
  }),
  Object.freeze({
    id: "support_followup",
    title: "Support Follow-up",
    body: "Owns follow-through on refunds, claims, and unresolved support issues until the outcome is explicit.",
    displayName: "Support Follow-up",
    description: "A managed specialist for support escalation, refund tracking, and claims-style follow-up.",
    capabilities: Object.freeze(["capability://consumer.support.follow_up"]),
    priceAmountCents: 460,
    priceCurrency: "USD",
    priceUnit: "task",
    runtimeName: "nooterra",
    tags: Object.freeze(["phase1", "support", "refund"]),
    familyIds: Object.freeze(["support_follow_up"])
  }),
  Object.freeze({
    id: "document_packager",
    title: "Document Packager",
    body: "Collects the required materials and turns them into a submission-ready packet or handoff bundle.",
    displayName: "Document Packager",
    description: "A managed specialist for document collection, admin packaging, and submission prep.",
    capabilities: Object.freeze(["capability://consumer.document.collect", "capability://consumer.document.package"]),
    priceAmountCents: 380,
    priceCurrency: "USD",
    priceUnit: "task",
    runtimeName: "nooterra",
    tags: Object.freeze(["phase1", "documents", "admin"]),
    familyIds: Object.freeze(["document_admin_packaging"])
  })
]);

export const PHASE1_BLOCKED_TASK_CATEGORIES = Object.freeze([
  Object.freeze({
    categoryId: "large_legal_commitment",
    label: "Large legal commitments",
    summary: "Signing, filing, or committing the user to a consequential legal action.",
    signals: Object.freeze(["lawsuit", "legal filing", "sign this contract", "incorporate", "nda", "settlement agreement", "power of attorney"])
  }),
  Object.freeze({
    categoryId: "medical_decision",
    label: "Medical decisions",
    summary: "Diagnosis, prescriptions, treatment recommendations, or clinical decision making.",
    signals: Object.freeze(["diagnose", "diagnosis", "prescription", "medication", "treatment plan", "symptoms", "medical advice"])
  }),
  Object.freeze({
    categoryId: "unrestricted_financial_transfer",
    label: "Unrestricted financial transfers",
    summary: "Moving money, wiring funds, or making open-ended financial decisions.",
    signals: Object.freeze(["wire money", "bank transfer", "send money", "move funds", "crypto transfer", "pay this person", "investment allocation"])
  }),
  Object.freeze({
    categoryId: "open_ended_background_autonomy",
    label: "Open-ended background autonomy",
    summary: "Long-horizon autonomous delegation without a bounded task envelope.",
    signals: Object.freeze(["run my life", "always monitor", "every week forever", "handle everything automatically", "full autopilot"])
  }),
  Object.freeze({
    categoryId: "physical_world_control",
    label: "Physical-world control",
    summary: "Construction, robotics, vehicles, or other direct control of physical systems.",
    signals: Object.freeze(["drive my car", "robot", "construction project", "factory", "warehouse robot", "drone"])
  })
]);

function countSignalMatches(textLower, signals) {
  let score = 0;
  const matchedSignals = [];
  for (const signal of Array.isArray(signals) ? signals : []) {
    const normalized = String(signal ?? "").trim().toLowerCase();
    if (!normalized) continue;
    if (!textLower.includes(normalized)) continue;
    score += normalized.includes(" ") ? 3 : 2;
    matchedSignals.push(signal);
  }
  return { score, matchedSignals };
}

function pickBestCategory(textLower, categories) {
  const scored = [];
  for (const category of categories) {
    const { score, matchedSignals } = countSignalMatches(textLower, category?.signals ?? []);
    scored.push({
      ...category,
      score,
      matchedSignals
    });
  }
  scored.sort((left, right) => right.score - left.score || String(left.categoryId).localeCompare(String(right.categoryId)));
  return scored[0] ?? null;
}

function summarizeSupportedCategory(category) {
  return {
    categoryId: category.categoryId,
    label: category.label,
    summary: category.summary,
    completionContract: category.completionContract
  };
}

function summarizeBlockedCategory(category) {
  return {
    categoryId: category.categoryId,
    label: category.label,
    summary: category.summary
  };
}

export function listPhase1SupportedTaskFamilies() {
  return PHASE1_SUPPORTED_TASK_CATEGORIES.map((category) => summarizeSupportedCategory(category));
}

export function listPhase1BlockedTaskFamilies() {
  return PHASE1_BLOCKED_TASK_CATEGORIES.map((category) => summarizeBlockedCategory(category));
}

export function getPhase1SupportedTaskFamily(categoryId) {
  const normalized = String(categoryId ?? "").trim();
  if (!normalized) return null;
  const category = PHASE1_SUPPORTED_TASK_CATEGORIES.find((entry) => entry.categoryId === normalized);
  return category ? summarizeSupportedCategory(category) : null;
}

export function normalizePhase1ExecutionAdapter(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const supportedSessionModes = Array.isArray(value.supportedSessionModes)
    ? value.supportedSessionModes.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  const requiredRunFields = Array.isArray(value.requiredRunFields)
    ? value.requiredRunFields.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  const adapterId = String(value.adapterId ?? "").trim();
  const mode = String(value.mode ?? "").trim();
  if (!adapterId || !mode) return null;
  return Object.freeze({
    schemaVersion: String(value.schemaVersion ?? PHASE1_EXECUTION_ADAPTER_SCHEMA_VERSION),
    adapterId,
    mode,
    requiresDelegatedAccountSession: value.requiresDelegatedAccountSession === true,
    supportedSessionModes,
    requiredRunFields,
    merchantScope: value.merchantScope === null || value.merchantScope === undefined ? null : String(value.merchantScope).trim() || null,
    reviewPolicy: value.reviewPolicy === null || value.reviewPolicy === undefined ? null : String(value.reviewPolicy).trim() || null
  });
}

export function getPhase1ManagedWorkerMetadata(profile) {
  if (!profile || typeof profile !== "object") throw new TypeError("profile is required");
  const familyIds = Array.isArray(profile.familyIds) ? profile.familyIds.map((value) => String(value ?? "").trim()).filter(Boolean) : [];
  const families = familyIds.map((familyId) => getPhase1SupportedTaskFamily(familyId)).filter(Boolean);
  const executionAdapter = normalizePhase1ExecutionAdapter(profile.executionAdapter);
  return Object.freeze({
    schemaVersion: PHASE1_MANAGED_WORKER_METADATA_SCHEMA_VERSION,
    profileId: String(profile.id ?? ""),
    familyIds,
    families,
    executionAdapter,
    proofCoverage: families.map((family) => ({
      categoryId: family.categoryId,
      requiredEvidence: Array.isArray(family.completionContract?.evidenceRequirements)
        ? [...family.completionContract.evidenceRequirements]
        : [],
      proofSummary: family.completionContract?.proofSummary ?? null
    }))
  });
}

export function listPhase1ManagedSpecialistsForCategory(categoryId) {
  const normalizedCategoryId = String(categoryId ?? "").trim();
  if (!normalizedCategoryId) return [];
  return PHASE1_MANAGED_SPECIALIST_PROFILES
    .filter((profile) => Array.isArray(profile?.familyIds) && profile.familyIds.includes(normalizedCategoryId))
    .map((profile) => {
      const metadata = getPhase1ManagedWorkerMetadata(profile);
      return Object.freeze({
        profileId: String(profile.id ?? "").trim(),
        title: String(profile.title ?? profile.displayName ?? profile.id ?? "").trim() || "Managed specialist",
        displayName: String(profile.displayName ?? profile.title ?? profile.id ?? "").trim() || "Managed specialist",
        description: String(profile.description ?? profile.body ?? "").trim() || null,
        capabilities: Array.isArray(profile.capabilities) ? profile.capabilities.map((value) => String(value ?? "").trim()).filter(Boolean) : [],
        tags: Array.isArray(profile.tags) ? profile.tags.map((value) => String(value ?? "").trim()).filter(Boolean) : [],
        priceAmountCents: Number.isSafeInteger(Number(profile.priceAmountCents)) ? Number(profile.priceAmountCents) : null,
        priceCurrency: String(profile.priceCurrency ?? "").trim() || null,
        priceUnit: String(profile.priceUnit ?? "").trim() || null,
        executionAdapter: metadata.executionAdapter ?? null,
        proofCoverage: Array.isArray(metadata.proofCoverage) ? metadata.proofCoverage : []
      });
    })
    .sort((left, right) => String(left.displayName ?? left.profileId ?? "").localeCompare(String(right.displayName ?? right.profileId ?? "")));
}

function normalizePolicyResult({
  status,
  reasonCode,
  category = null,
  message,
  supportedCategories,
  blockedCategories
} = {}) {
  return Object.freeze({
    schemaVersion: PHASE1_TASK_POLICY_SCHEMA_VERSION,
    status,
    reasonCode,
    categoryId: category?.categoryId ?? null,
    categoryLabel: category?.label ?? null,
    categorySummary: category?.summary ?? null,
    completionContract: category?.completionContract ?? null,
    matchedSignals: Array.isArray(category?.matchedSignals) ? [...category.matchedSignals] : [],
    message,
    supportedCategories,
    blockedCategories
  });
}

export function evaluatePhase1TaskPolicy({ text } = {}) {
  const requestText = String(text ?? "").trim();
  if (!requestText) throw new TypeError("text is required");
  const textLower = requestText.toLowerCase();
  const supportedCategories = PHASE1_SUPPORTED_TASK_CATEGORIES.map((category) => ({
    ...summarizeSupportedCategory(category)
  }));
  const blockedCategories = PHASE1_BLOCKED_TASK_CATEGORIES.map((category) => summarizeBlockedCategory(category));

  const blocked = pickBestCategory(textLower, PHASE1_BLOCKED_TASK_CATEGORIES);
  if (blocked && blocked.score > 0) {
    return normalizePolicyResult({
      status: PHASE1_TASK_POLICY_STATUS.BLOCKED,
      reasonCode: PHASE1_TASK_POLICY_REASON_CODE.BLOCKED_CATEGORY,
      category: blocked,
      message: `${blocked.label} are blocked in the Phase 1 consumer shell.`,
      supportedCategories,
      blockedCategories
    });
  }

  const supported = pickBestCategory(textLower, PHASE1_SUPPORTED_TASK_CATEGORIES);
  if (supported && supported.score > 0) {
    return normalizePolicyResult({
      status: PHASE1_TASK_POLICY_STATUS.SUPPORTED,
      reasonCode: PHASE1_TASK_POLICY_REASON_CODE.SUPPORTED_CATEGORY,
      category: supported,
      message: `${supported.label} are in scope for the Phase 1 consumer shell.`,
      supportedCategories,
      blockedCategories
    });
  }

  return normalizePolicyResult({
    status: PHASE1_TASK_POLICY_STATUS.UNKNOWN,
    reasonCode: PHASE1_TASK_POLICY_REASON_CODE.CATEGORY_NOT_SUPPORTED,
    category: null,
    message: "This request is outside the supported Phase 1 consumer task families.",
    supportedCategories,
    blockedCategories
  });
}
