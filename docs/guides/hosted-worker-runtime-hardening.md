# Hosted Worker Runtime Hardening

This guide defines the backend bar for the hosted worker runtime in `services/scheduler`.

## Standards

- Fail closed on incomplete or ambiguous execution outcomes.
- Keep approval, execution, and verification data contracts typed and aligned across migrations, bootstrap SQL, runtime writes, and API reads.
- Prefer deterministic policy checks over prompt-only controls for action gating.
- Treat approval replay as a first-class execution path, not a best-effort retry.
- Promote autonomy only from verified execution outcomes plus explicit approval history.
- Add focused unit coverage for every new runtime contract before expanding feature surface.

## Implemented In This Hardening Tranche

- Canonicalized hosted approval records around `execution_id`, `action`, `matched_rule`, `action_hash`, `status`, and `decision`.
- Added hosted deterministic world-model predicate enforcement before tool execution.
- Added database-enforced state machines for `worker_executions` and `worker_approvals`.
- Added hosted verification receipts with default fail-closed assertions for:
  - blocked actions
  - pending approvals
  - interrupted executions
  - tool execution errors
  - duration limits
- Fixed approval replay so resumed executions re-run the approved tool calls instead of blindly re-prompting the LLM.
- Fixed execution updates so resumed runs can clear stale `error` fields on the reused execution row.
- Replaced the placeholder trust-promotion heuristic with approval + verified-execution analysis and worker-level learning analytics.
- Persisted structured learning signals with rule matches, approval outcomes, verifier outcomes, interruption codes, and tool-level success/failure.
- Added a durable side-effect journal for outbound builtin tools so email, SMS, voice, payments, and payment requests are replay-protected and auditable.
- Added replay counters and last-replay timestamps for outbound builtin side effects so duplicate-prevention shows up in durable telemetry.
- Enforced per-worker/per-tool daily caps for high-risk outbound builtin tools before execution.
- Added a durable inbound webhook ingress journal so worker trigger webhooks are replay-safe, dead-lettered on rejection, and retain signature/payload evidence.
- Added generic HMAC and Twilio signature verification hooks for inbound worker webhooks, alongside exact-delivery deduplication on the trigger route.
- Added provider-aware inbound event normalization for Twilio SMS/voice and email-style webhook payloads so queued webhook executions carry structured ingress context instead of only raw payload logs.
- Added tenant-wide explainability/risk summary APIs for worker learning, verifier failures, unstable rules, replayed side effects, dead-lettered inbound webhooks, and replayed inbound deliveries.
- Added deterministic inbound anomaly alerts for repeated signature failures, dead-letter bursts, and replay spikes per worker/provider.
- Added deterministic ingress enforcement so signature/dead-letter bursts auto-pause workers, active replay spikes trigger provider cooldowns, and stale replay spikes force approval re-entry on the next execution.
- Added shared runtime enforcement for outbound provider failures and verification regressions so repeated side-effect failures can trigger cooldowns, approval re-entry, or worker auto-pause, and repeated failed verification outcomes can force approval re-entry or auto-pause the worker.
- Added deterministic approval-thrash enforcement so repeated deny/edit/timeout decisions can trigger tool-specific blocks, worker-wide approval re-entry, or worker auto-pause.
- Added target-level payment safety envelopes for `make_payment` and `request_payment`, including duplicate-request suppression across executions and recipient/request-target daily amount caps.
- Added persisted tenant worker runtime policies so approval, verification, outbound provider, and inbound webhook enforcement thresholds/actions are configurable without changing code.
- Added per-worker and per-tool runtime policy layering on top of the tenant baseline, with deterministic precedence and scope metadata returned by the control-plane API.
- Added OpenAPI coverage for the operator-facing worker learning, verifier failure, replay, and risk queue routes.
- Added operator drilldowns for execution verification, approval timelines, side-effect journals, and worker webhook ingress evidence.
- Wired the product dashboard performance surface to consume the worker learning overview, risk queue, verifier failure, and replay endpoints.
- Added committed Twilio and Resend response fixtures so provider contract tests exercise realistic success payload shapes.
- Added a focused scheduler runtime hardening CI gate and wired it into the shared test workflow.
- Fixed hosted scheduler post-run accounting so only genuinely successful executions increment `successfulRuns`, while verification failures and auto-pauses increment failure stats and no longer trigger completion notifications or chain dispatch.

## Operator API Surface

- `GET /v1/workers/learning/overview`
  - Tenant-wide worker learning summary, promotion candidates, unstable rules, verifier failures, outbound side-effect telemetry, and inbound webhook risk telemetry.
- `GET /v1/workers/verification/failures`
  - Recent verifier failures across the tenant with failed assertions attached.
- `GET /v1/workers/side-effects/replays`
  - Recent replayed outbound side effects with replay counts and provider references.
- `GET /v1/workers/webhooks/dead-letters`
  - Recent dead-lettered inbound webhook deliveries across the tenant with signature and reason metadata.
- `GET /v1/workers/webhooks/replays`
  - Recent replayed inbound webhook deliveries across the tenant with replay counts and dedupe metadata.
- `GET /v1/workers/webhooks/anomalies`
  - Recent inbound webhook anomaly alerts across the tenant, including signature-failure bursts, dead-letter bursts, and replay spikes.
- `GET /v1/workers/approvals/anomalies`
  - Recent approval anomaly alerts across the tenant, including repeated deny/edit/timeout cycles that triggered runtime restrictions.
- `GET /v1/workers/runtime-policy`
  - Returns the tenant baseline runtime-policy overrides plus the effective merged policy used by the hosted scheduler.
- `PUT /v1/workers/runtime-policy`
  - Replaces the tenant's runtime-policy overrides. Sending `{}` resets the tenant to the platform defaults.
- `GET /v1/workers/{workerId}/runtime-policy`
  - Returns the worker's effective runtime policy, including tenant overrides, worker overrides, tool-scoped effective policies, and scope metadata describing where each section came from.
- `PUT /v1/workers/{workerId}/runtime-policy`
  - Replaces the worker's runtime-policy overrides. Sending `{}` resets the worker to the tenant baseline.
- `GET /v1/workers/risk/queue`
  - Operator queue sorted by worker risk score and annotated with human-readable reasons, including inbound webhook failures and replays.
- `GET /v1/workers/{workerId}/executions/latest`
  - Latest execution drilldown with verification receipts, approvals, side effects, and runtime activity.
- `GET /v1/workers/{workerId}/executions/{executionId}`
  - Specific execution drilldown for operator investigation.
- `GET /v1/workers/{workerId}/executions/{executionId}/approvals`
  - Execution-scoped approval timeline.
- `GET /v1/workers/{workerId}/side-effects`
  - Worker-scoped outbound side-effect journal.
- `GET /v1/workers/{workerId}/side-effects/{sideEffectId}`
  - Side-effect journal detail with request and provider response evidence.
- `GET /v1/workers/{workerId}/webhooks`
  - Worker-scoped inbound webhook ingress journal, including dead-lettered deliveries.
- `GET /v1/workers/{workerId}/webhooks/{ingressId}`
  - Inbound webhook ingress detail with sanitized headers, payload snapshot, raw body, and signature evidence.

## Next Backend Phases

1. Expand verification plans per worker type.
   - Support worker-specific required tools, response evidence patterns, and negative assertions.
2. Expand provider adapters in the contract suite.
   - Add more real provider payload fixtures for Twilio, Resend, and future inbound providers.
3. Normalize more inbound providers behind the ingress journal.
   - Add provider-specific payload adapters for email-style inbound events and any future webhook source before exposing them to worker triggers.
4. Expand runtime enforcement beyond the current failure classes.
   - Add deterministic responses for newly onboarded providers, budget exhaustion, and tenant-configured escalation policies beyond the current approval, webhook, outbound-provider, and verification classes.
5. Add runtime policy audit history.
   - Persist diffable runtime-policy change history per tenant and per worker so operators can explain exactly when thresholds changed and who changed them.

## Shipping Rule

Do not ship new autonomy or new external integrations unless all of the following are true:

- the tool/action is represented in the hosted charter and approval data model
- the execution path emits a verification receipt
- at least one deterministic test covers the fail-closed behavior
- approval replay works when the tool requires `askFirst`
