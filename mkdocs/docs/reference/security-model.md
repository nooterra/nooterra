# Security Model

Settld assumes agent actions are untrusted until policy and evidence checks pass.

## Enforcement model

- Fail closed for missing/invalid policy or evidence requirements
- Deterministic reason codes on allow/challenge/deny/escalate outcomes
- Binding checks prevent replay/mutation of approved intents

## Cryptographic and integrity controls

- Signature verification on receipt/evidence artifacts
- Request binding and quote-binding verification in payment flows
- Signed operator escalation decisions
- Offline verification support through closepack exports

## Operational controls

- Scoped API keys and tenant isolation
- Webhook signature verification + secret rotation
- Historical key retention for long-lived verification windows
- Emergency controls: freeze, unwind, reversal dispatch

## Security posture by design

Settld does not rely on "trust me" runtime behavior.
It produces deterministic artifacts that can be independently checked.
