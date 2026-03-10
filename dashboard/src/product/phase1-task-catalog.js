const PHASE1_MANAGED_WORKER_METADATA_SCHEMA_VERSION = "Phase1ManagedWorkerMetadata.v1";

export const phase1NetworkTemplates = Object.freeze([
  Object.freeze({
    id: "purchase_under_cap",
    categoryId: "purchases_under_cap",
    title: "Buy Under A Cap",
    body: "Source a product, stay inside a budget, and complete the purchase with proof.",
    text: "Find the best replacement office chair under $400, compare the viable options, and order the best one inside the cap.",
    budgetCents: "40000",
    maxCandidates: "4"
  }),
  Object.freeze({
    id: "schedule_booking",
    categoryId: "scheduling_booking",
    title: "Book An Appointment",
    body: "Coordinate around calendar constraints and lock the requested slot.",
    text: "Book a dentist appointment next Tuesday afternoon that fits my calendar and return the confirmation details.",
    budgetCents: "15000",
    maxCandidates: "3"
  }),
  Object.freeze({
    id: "subscription_cancellation",
    categoryId: "subscriptions_cancellations",
    title: "Cancel A Subscription",
    body: "Handle a bounded account or billing task and return the confirmation trail.",
    text: "Cancel my unused gym membership and return the confirmation number plus any final billing date.",
    budgetCents: "10000",
    maxCandidates: "3"
  }),
  Object.freeze({
    id: "refund_follow_up",
    categoryId: "support_follow_up",
    title: "Chase A Refund",
    body: "Follow up on an unresolved support issue until it is closed or escalated.",
    text: "Track down why my refund never arrived, follow up with support, and keep the timeline updated until it is resolved.",
    budgetCents: "12000",
    maxCandidates: "4"
  })
]);

export const phase1SupportedTaskFamilies = Object.freeze([
  Object.freeze({
    categoryId: "comparison_selection",
    title: "Comparison and selection",
    body: "Compare options, narrow the choices, and recommend the best fit within a clear constraint.",
    completionContract: Object.freeze({
      summary: "Done when the network returns a ranked short list, a recommended choice, and the reasons behind it.",
      evidenceRequirements: Object.freeze(["option_summary", "source_links", "decision_rationale"]),
      proofSummary: "A comparison summary, source trail, and final recommendation."
    })
  }),
  Object.freeze({
    categoryId: "purchases_under_cap",
    title: "Purchases under a cap",
    body: "Find, compare, and buy products within a bounded budget.",
    completionContract: Object.freeze({
      summary: "Done when the item is selected inside the cap, purchased, and the receipt trail is attached.",
      evidenceRequirements: Object.freeze(["receipt", "merchant_confirmation", "price_breakdown"]),
      proofSummary: "An item decision record, purchase receipt, and merchant confirmation."
    })
  }),
  Object.freeze({
    categoryId: "scheduling_booking",
    title: "Scheduling and booking",
    body: "Book appointments, reservations, and calendar-bound tasks.",
    completionContract: Object.freeze({
      summary: "Done when a bounded time slot is booked or the blocking constraint is made explicit.",
      evidenceRequirements: Object.freeze(["booking_confirmation", "calendar_hold_or_event", "availability_trace"]),
      proofSummary: "A booking confirmation or a documented reason no valid slot could be secured."
    })
  }),
  Object.freeze({
    categoryId: "subscriptions_cancellations",
    title: "Subscriptions and cancellations",
    body: "Cancel or change memberships, plans, and recurring services.",
    completionContract: Object.freeze({
      summary: "Done when the plan change or cancellation is confirmed, denied with reason, or waiting on user action.",
      evidenceRequirements: Object.freeze(["cancellation_number", "provider_confirmation", "billing_change_summary"]),
      proofSummary: "A cancellation number or provider confirmation with the new billing state."
    })
  }),
  Object.freeze({
    categoryId: "support_follow_up",
    title: "Support and refund follow-up",
    body: "Follow support issues, refunds, and claims through resolution.",
    completionContract: Object.freeze({
      summary: "Done when the issue is resolved, escalated with context, or blocked on external response with the follow-up trail intact.",
      evidenceRequirements: Object.freeze(["ticket_reference", "message_log", "resolution_summary"]),
      proofSummary: "A support timeline with ticket references, outbound messages, and the final resolution state."
    })
  }),
  Object.freeze({
    categoryId: "travel_logistics",
    title: "Travel and logistics",
    body: "Research and book bounded travel and itinerary elements.",
    completionContract: Object.freeze({
      summary: "Done when the requested travel component is booked within constraints or the best alternatives are returned with proof.",
      evidenceRequirements: Object.freeze(["booking_confirmation", "itinerary_summary", "price_trace"]),
      proofSummary: "A booking confirmation or itinerary recommendation backed by price and availability evidence."
    })
  }),
  Object.freeze({
    categoryId: "document_admin_packaging",
    title: "Document gathering and admin packaging",
    body: "Collect documents and package routine admin work for submission.",
    completionContract: Object.freeze({
      summary: "Done when the required materials are assembled into a submission-ready packet or the missing inputs are explicit.",
      evidenceRequirements: Object.freeze(["document_manifest", "packet_copy", "submission_or_handoff_note"]),
      proofSummary: "A manifest of gathered materials plus the final packet or handoff artifact."
    })
  })
]);

export const phase1BlockedTaskFamilies = Object.freeze([
  Object.freeze({
    categoryId: "large_legal_commitment",
    title: "Large legal commitments"
  }),
  Object.freeze({
    categoryId: "medical_decision",
    title: "Medical decisions"
  }),
  Object.freeze({
    categoryId: "unrestricted_financial_transfer",
    title: "Unrestricted financial transfers"
  }),
  Object.freeze({
    categoryId: "open_ended_background_autonomy",
    title: "Open-ended background autonomy"
  }),
  Object.freeze({
    categoryId: "physical_world_control",
    title: "Physical-world control"
  })
]);

export const phase1ManagedSpecialistProfiles = Object.freeze([
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
    familyIds: Object.freeze(["purchases_under_cap"])
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
    familyIds: Object.freeze(["scheduling_booking", "travel_logistics"])
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
    familyIds: Object.freeze(["subscriptions_cancellations"])
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

export function getPhase1SupportedTaskFamily(categoryId) {
  return phase1SupportedTaskFamilies.find((family) => family.categoryId === categoryId) ?? null;
}

export function getPhase1ManagedWorkerMetadata(profile) {
  const familyIds = Array.isArray(profile?.familyIds) ? profile.familyIds : [];
  const families = familyIds.map((familyId) => getPhase1SupportedTaskFamily(familyId)).filter(Boolean);
  return Object.freeze({
    schemaVersion: PHASE1_MANAGED_WORKER_METADATA_SCHEMA_VERSION,
    profileId: String(profile?.id ?? ""),
    familyIds: Object.freeze([...familyIds]),
    families: Object.freeze(families.map((family) => ({
      categoryId: family.categoryId,
      title: family.title,
      body: family.body,
      completionContract: family.completionContract
    }))),
    proofCoverage: Object.freeze(
      families.map((family) => ({
        categoryId: family.categoryId,
        requiredEvidence: family.completionContract.evidenceRequirements,
        proofSummary: family.completionContract.proofSummary
      }))
    )
  });
}
