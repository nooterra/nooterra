# Support Macros

Use these macros for the top launch failure modes.

Each macro is tied to an actual product state so support and ops stay aligned.

## How to use this page

1. Identify the visible product state.
2. Pick the matching macro.
3. Send the customer-facing response.
4. Follow the operator actions exactly; do not improvise a bypass.

## Macro: refund denied

### When to use it

Use when:

- a refund request was rejected by the runtime or provider
- the receipt shows a completed action but no refund path was granted
- an operator confirms the refund was denied rather than still pending

### Customer response

> We were able to confirm the original action, but the refund path is currently denied for this receipt. We are reviewing the linked receipt, settlement state, and provider response before retrying anything. We will update you with the next step once we confirm whether this can be retried, reversed, or must remain closed.

### Operator actions

1. Open the linked receipt and settlement details.
2. Confirm whether the denial came from provider state, verifier state, or dispute window expiry.
3. If the denial is caused by drift or mismatch, move into dispute or operator rescue instead of retrying blindly.
4. Preserve the receipt id, settlement state, and provider error before escalating.

## Macro: dispute insufficient evidence

### When to use it

Use when:

- a dispute is open but the user did not provide enough information
- the receipt exists, but the issue description or proof is too thin to route correctly
- the dispute cannot be resolved without more context

### Customer response

> We opened the dispute, but we still need more detail to move it forward. Please reply with the exact receipt or approval link you used, what outcome looked wrong, and any confirming evidence you have. Once that is attached to the existing dispute, we can continue review without losing your place in the queue.

### Operator actions

1. Keep the dispute attached to the original receipt/run.
2. Request missing evidence through the existing dispute path; do not create a second case.
3. Mark the current state as waiting for evidence, not resolved.
4. Keep the recourse window visible so the user knows whether time remains.

## Macro: grant mismatch

### When to use it

Use when:

- the host attempted to continue with an expired, revoked, or mismatched grant
- approval scope and execution scope no longer line up
- the runtime correctly failed closed before completing the action

### Customer response

> The action did not continue because the approval scope no longer matched the runtime state. This usually means the approval expired, was revoked, or the host tried to resume with stale authority. We have not treated the action as successful. The safe next step is to reopen the request and issue a fresh approval.

### Operator actions

1. Confirm whether the mismatch was caused by expiry, revocation, host replay, or scope drift.
2. Do not reuse the stale grant.
3. Direct the user back to a fresh approval path.
4. If the same host repeats this failure, consider host quarantine or channel pause.

## Macro: verification failed

### When to use it

Use when:

- the action completed but the verifier did not accept the result
- the receipt is present but verifier state is fail, insufficient, or operator review
- support needs to explain why the action is not trusted yet

### Customer response

> The action completed, but the returned proof did not pass verification yet. That means we are not treating the outcome as fully trusted until the linked receipt and evidence are reviewed. If the result looks wrong to you, open the dispute path from the receipt and we will continue from the same artifact chain.

### Operator actions

1. Open the receipt and verifier detail.
2. Confirm whether the failure is evidence quality, settlement drift, or runtime binding mismatch.
3. If needed, move into dispute or rescue without mutating the original artifact chain.
4. Preserve the verifier reason and receipt id in the support trail.

## Tone rules

Every macro should:

- state what happened clearly
- say whether the action is trusted, paused, or blocked
- avoid promising a refund or reversal before the runtime supports it
- point the user to the next real artifact or action

## Related guides

- [Incident Response](incidents.md)
- [Launch Checklist](launch-checklist.md)
