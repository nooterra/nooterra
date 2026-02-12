# Settld Docs

Settld is the enforceable transaction layer for autonomous work.

If your system can call tools but cannot prove **who agreed to what**, **what happened**, and **why money moved**, you do not have commerce. You have logs.

Settld gives you a canonical economic loop:

`Agreement -> Hold -> Evidence -> Decision -> Receipt -> Dispute -> Adjustment`

This docs portal is organized for implementation speed:

1. [Quickstart](./quickstart.md) — run locally and verify the full loop in minutes.
2. [Core Primitives](./core-primitives.md) — understand objects, bindings, and invariants.
3. [API Reference](./api-reference.md) — endpoint map + auth model + payload conventions.
4. [Conformance](./conformance.md) — machine-check expected behavior.
5. [Closepacks](./closepacks.md) — export and verify offline.
6. [Guides](./guides.md) — common integration patterns.
7. [Security Model](./security-model.md) — what is guaranteed and what is not.

## Who this is for

- Capability providers who need enforceable paid calls
- Agent builders who need replayable outcomes
- Marketplace/platform teams that need standardized disputes and settlement proofs
- Security/compliance teams that need portable audit artifacts

## Kernel v0 scope (current)

Settld Kernel v0 is centered on **paid capability calls** and their enforceable lifecycle.

It includes:

- Signed agreement/evidence/decision/receipt artifacts
- Holdbacks and challenge windows
- Signed dispute-open envelopes
- Deterministic settlement adjustments
- Replay-evaluate checks
- Closepack export + offline verification
- Conformance pack assertions

## Next steps

- If you are evaluating quickly: start at [Quickstart](./quickstart.md)
- If you are integrating deeply: read [Core Primitives](./core-primitives.md) then [API Reference](./api-reference.md)
- If you are validating trust posture: read [Conformance](./conformance.md) and [Closepacks](./closepacks.md)
