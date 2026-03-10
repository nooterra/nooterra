# Action Wallet V1 First 10 Ticket Packet

Date: March 9, 2026  
Source backlog: [planning/linear/action-wallet-v1-backlog.json](/Users/aidenlippert/nooterra/planning/linear/action-wallet-v1-backlog.json)  
GitHub mirror: [planning/github/action-wallet-v1-issues.json](/Users/aidenlippert/nooterra/planning/github/action-wallet-v1-issues.json)

## Purpose

Define the first 10 implementation tickets to kick off the Action Wallet build.

This packet intentionally starts with the nine Sprint 0 contract-freeze tickets and then moves to the first host-facing API endpoint:

1. `ACT-001` through `ACT-009`
2. `ACT-020`

## Sequence

| Order | Ticket | GitHub | Sprint | Owner |
| --- | --- | --- | --- | --- |
| 1 | `ACT-001` Freeze v1 object model | [#222](https://github.com/nooterra/nooterra/issues/222) | Sprint 0 | Lane A |
| 2 | `ACT-002` Define intent state machine | [#223](https://github.com/nooterra/nooterra/issues/223) | Sprint 0 | Lane A |
| 3 | `ACT-003` Define approval state machine | [#224](https://github.com/nooterra/nooterra/issues/224) | Sprint 0 | Lane A |
| 4 | `ACT-004` Define execution grant semantics | [#225](https://github.com/nooterra/nooterra/issues/225) | Sprint 0 | Lane A |
| 5 | `ACT-005` Define receipt semantics | [#226](https://github.com/nooterra/nooterra/issues/226) | Sprint 0 | Lane A |
| 6 | `ACT-006` Define dispute lifecycle | [#227](https://github.com/nooterra/nooterra/issues/227) | Sprint 0 | Lane A |
| 7 | `ACT-007` Define idempotency model | [#228](https://github.com/nooterra/nooterra/issues/228) | Sprint 0 | Lane A |
| 8 | `ACT-008` Define deterministic hashing | [#229](https://github.com/nooterra/nooterra/issues/229) | Sprint 0 | Lane A |
| 9 | `ACT-009` Define event taxonomy | [#230](https://github.com/nooterra/nooterra/issues/230) | Sprint 0 | Lane A |
| 10 | `ACT-020` `POST /v1/action-intents` | [#238](https://github.com/nooterra/nooterra/issues/238) | Sprint 1 | Lane A |

## Ticket Packet

### `ACT-001` Freeze v1 object model

GitHub: [#222](https://github.com/nooterra/nooterra/issues/222)

**Title**  
`ACT-001 Freeze v1 object model`

**Why**  
Locking the core objects early prevents silent contract drift across API, UI, and verification work.

**Scope**

- Define Action Intent through Settlement Event as the launch object set
- Pin schema names, field ownership, and persistence mappings
- Record unresolved object questions and close them in Sprint 0

**Out of scope**

- New object families beyond the nine launch objects
- Phase 1.5 contract expansion

**Acceptance criteria**

- Schema doc exists for all launch objects
- DB mappings exist for each locked object
- No unresolved field questions remain

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- None

### `ACT-002` Define intent state machine

GitHub: [#223](https://github.com/nooterra/nooterra/issues/223)

**Title**  
`ACT-002 Define intent state machine`

**Why**  
Intent state drift will break approvals, execution, and receipts unless transitions are explicit and enforced.

**Scope**

- Define draft through cancelled states
- Block invalid transitions at the domain layer
- Document the state diagram and transition log format

**Out of scope**

- Ad hoc state changes in handlers
- Extra launch states beyond the locked set

**Acceptance criteria**

- Invalid transitions are blocked
- Every transition is logged
- State diagram is documented

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- `ACT-001`

### `ACT-003` Define approval state machine

GitHub: [#224](https://github.com/nooterra/nooterra/issues/224)

**Title**  
`ACT-003 Define approval state machine`

**Why**  
Approval links and decisions need a single lifecycle so hosts and users read the same truth.

**Scope**

- Define pending through revoked states
- Specify expiry and revocation behavior
- Align decision writes to the approval lifecycle

**Out of scope**

- Multiple approval lifecycles by channel
- Reusable links beyond the launch rules

**Acceptance criteria**

- Approval states are locked to pending, approved, denied, expired, and revoked
- Expiry and revocation rules are explicit
- Decision writes use the same state model

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- `ACT-001`

### `ACT-004` Define execution grant semantics

GitHub: [#225](https://github.com/nooterra/nooterra/issues/225)

**Title**  
`ACT-004 Define execution grant semantics`

**Why**  
Grants are the core authority envelope; unclear semantics create uncapped or out-of-scope execution risk.

**Scope**

- Lock principal, action type, host, allowlist, spend cap, expiry, evidence requirements, nonce, and lineage reference fields
- Define grant validation semantics
- Specify how grants bind back to approvals

**Out of scope**

- Broad delegated authority outside launch actions
- Open multi-agent delegation semantics

**Acceptance criteria**

- All listed fields are defined
- Grant validation semantics are documented
- Approval binding rules are explicit

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- `ACT-001`
- `ACT-003`

### `ACT-005` Define receipt semantics

GitHub: [#226](https://github.com/nooterra/nooterra/issues/226)

**Title**  
`ACT-005 Define receipt semantics`

**Why**  
The launch promise collapses if receipts do not bind approval, grant, evidence, settlement, and dispute state.

**Scope**

- Define receipt bindings to approval, grant, evidence, settlement, verifier verdict, dispute state, and deterministic hash
- Specify required receipt fields for both launch actions
- Document receipt read model expectations

**Out of scope**

- Loose human-only confirmations
- Receipt fields not tied to a source object

**Acceptance criteria**

- Receipt schema binds all required objects
- Required launch fields are documented
- Deterministic hash rules are defined

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- `ACT-001`
- `ACT-004`

### `ACT-006` Define dispute lifecycle

GitHub: [#227](https://github.com/nooterra/nooterra/issues/227)

**Title**  
`ACT-006 Define dispute lifecycle`

**Why**  
Dispute state must be explicit before receipts and operator tools can attach recourse correctly.

**Scope**

- Define opened through resolved states
- Specify triage and evidence waiting behavior
- Document resolution end states

**Out of scope**

- Financial verdict logic beyond the lifecycle contract
- Custom dispute states by host runtime

**Acceptance criteria**

- Dispute states are locked
- Triage and evidence wait behavior is documented
- Resolution end states are explicit

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- `ACT-001`

### `ACT-007` Define idempotency model

GitHub: [#228](https://github.com/nooterra/nooterra/issues/228)

**Title**  
`ACT-007 Define idempotency model`

**Why**  
Create and finalize calls must be replay-safe before external hosts integrate.

**Scope**

- Define idempotency key handling for create and finalize endpoints
- Specify collision and replay responses
- Document storage and expiry expectations

**Out of scope**

- Best-effort duplicate suppression
- Endpoint-specific idempotency semantics

**Acceptance criteria**

- Create and finalize endpoints require idempotency support
- Replay behavior is documented
- Storage and expiry rules are explicit

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- `ACT-001`

### `ACT-008` Define deterministic hashing

GitHub: [#229](https://github.com/nooterra/nooterra/issues/229)

**Title**  
`ACT-008 Define deterministic hashing`

**Why**  
Stable hashes are required for receipts, offline verification, and launch-grade auditability.

**Scope**

- Define semantic sha256 hashing for intent, grant, evidence bundle, and receipt
- Document canonical serialization rules
- Specify versioning for future hash changes

**Out of scope**

- Non-canonical hashing behavior
- Hashing for Phase 1.5 objects

**Acceptance criteria**

- All four launch objects have stable semantic hashes
- Canonical serialization rules are documented
- Hash versioning strategy is defined

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- `ACT-001`

### `ACT-009` Define event taxonomy

GitHub: [#230](https://github.com/nooterra/nooterra/issues/230)

**Title**  
`ACT-009 Define event taxonomy`

**Why**  
Metrics, operator timelines, and debugging all depend on a stable event taxonomy from day one.

**Scope**

- Define the nine launch lifecycle events
- Name event payloads and emit points
- Map events to product and ops metrics

**Out of scope**

- Free-form event names
- Metrics that depend on undocumented events

**Acceptance criteria**

- All listed events are defined
- Emit points are documented
- Metric mapping exists for the launch board

**Tests**

- unit: schema and transition checks
- integration: persistence mappings
- manual: state diagram review

**Metrics**

- grant validation failures
- receipt coverage

**Dependencies**

- `ACT-002`
- `ACT-003`
- `ACT-006`

### `ACT-020` `POST /v1/action-intents`

GitHub: [#238](https://github.com/nooterra/nooterra/issues/238)

**Title**  
`ACT-020 POST /v1/action-intents`

**Why**  
Hosts need one canonical way to create launch-bound action intents.

**Scope**

- Create action intents through the public API
- Validate request shape against the locked object model
- Return stable identifiers and initial state

**Out of scope**

- Booking or Phase 1.5 action types
- Host-specific create flows

**Acceptance criteria**

- Action intents can be created
- Requests validate against the locked model
- Responses return stable identifiers and state

**Tests**

- unit: handler validation
- integration: end-to-end API lifecycle
- smoke: staged host flow

**Metrics**

- install-to-first-approval time
- approval completion rate
- finalize latency

**Dependencies**

- `ACT-001`
- `ACT-002`
