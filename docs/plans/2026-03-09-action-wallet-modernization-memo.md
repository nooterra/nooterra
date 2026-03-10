# Action Wallet Modernization Memo

Date: 2026-03-09

## Why "modern" here does not mean "more autonomous"

The current protocol and payments signal is converging on the same idea:

- humans stay in the approval path for consequential actions
- hosts need better async and context-passing ergonomics
- agent identity and provenance need to get stronger, not looser

For Action Wallet v1, that means the highest-value upgrades are protocol ergonomics and trust surfaces, not broader scope.

## Official signals

- Anthropic MCP guidance treats human-in-the-loop approval as a first-class pattern for side-effecting tools.
- Model Context Protocol is moving toward richer host ergonomics with resources and task-oriented async execution.
- Visa is publicly framing agentic commerce around trusted agents and explicit trust status, not anonymous bots.
- The IETF Web Bot Auth work points toward stronger browser- and agent-identity signaling.
- Passkey guidance continues to move toward lower-friction enrollment and recovery instead of brittle auth ceremonies.

## Adopted now

The current repo changes adopt three v1-compatible upgrades:

1. MCP resources for Action Wallet context

- Static resources now expose launch scope, host flow, and tooling context.
- Dynamic resource templates now expose action intents, approval requests, execution grants, receipts, and disputes.

2. MCP task-style async execution for Action Wallet tools

- Action Wallet host tools now support task-augmented `tools/call`.
- Hosts can move long-running approval or verification work across turns with `tasks/get`, `tasks/list`, `tasks/result`, and `tasks/cancel`.

3. Launch docs now explain the modern host path explicitly

- Resources are the preferred context channel.
- Task mode is the preferred async channel.
- Execution remains host-side in v1.

## Next modern upgrades after this patch

1. Trusted host request signing

- Add HTTP message signatures or equivalent signed host callbacks so "trusted host" means more than an opaque API key.

2. Embedded MCP app surfaces

- Add host-renderable approval, receipt, and dispute cards as a progressive enhancement over hosted pages.

3. Passkey conditional enrollment

- Offer conditional passkey creation and stronger post-sign-in passkey upgrade flows in onboarding.

4. Richer host attestation

- Bind host install records to stronger runtime identity and provenance fields so operator quarantine and dispute review are easier.

## Operating rule

For Action Wallet v1, "state of the art" means:

- lower host friction
- stronger approval and trust surfaces
- better async ergonomics
- tighter provenance

It does not mean wider action scope.
