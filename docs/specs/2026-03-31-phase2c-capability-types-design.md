# Phase 2C: Capability Type System

**Date**: 2026-03-31
**Status**: Approved
**Goal**: Add parameterized capability enforcement alongside existing string charters. Tool calls are checked against typed constraints (domains, amounts, rate limits) deterministically, not by fuzzy string matching.

---

## Problem

Current enforcement: LLM calls `send_email(to: "random@gmail.com")`. The system builds an action string `"send_email to random@gmail.com"` and fuzzy-matches it against charter strings like `"Send emails"`. This is:
- Non-deterministic (keyword overlap scoring)
- Not parameterized (can't say "only @company.com domains")
- Not auditable (can't prove WHY a tool call was allowed/blocked)

## Design

### Approach: Additive, not replacement

String charters (canDo/askFirst/neverDo) still work. Capabilities are a NEW optional field on the charter that provides deterministic enforcement when defined. If a tool has a capability definition, it's checked first. If not, fallback to string matching.

### Charter extension

```json
{
  "canDo": ["Read emails", "Answer FAQs"],
  "askFirst": ["Reschedule jobs"],
  "neverDo": ["Cancel without approval"],
  "capabilities": {
    "send_email": {
      "allow": "canDo",
      "constraints": {
        "to_domains": ["@mycompany.com", "@vendor.com"],
        "max_per_day": 20
      }
    },
    "make_payment": {
      "allow": "askFirst",
      "constraints": {
        "max_amount_usd": 500
      }
    },
    "delete_record": {
      "allow": "neverDo"
    },
    "web_search": {
      "allow": "canDo"
    }
  }
}
```

### Enforcement flow

```
Tool call arrives (toolName, toolArgs)
  → Does charter.capabilities[toolName] exist?
    → YES: check capability constraints deterministically
      → Constraints pass? → Use capability.allow (canDo/askFirst/neverDo)
      → Constraints fail? → BLOCK with specific reason ("to domain @gmail.com not in allowlist")
    → NO: fall back to existing string-based enforceCharter()
```

### Constraint types

| Constraint | Applies to | What it checks |
|-----------|-----------|----------------|
| `to_domains` | email tools | Recipient email domain must be in allowlist |
| `max_amount_usd` | payment tools | Amount must be ≤ limit |
| `max_per_day` | any tool | Daily call count for this tool ≤ limit |
| `allowed_values` | any arg | Argument value must be in explicit list |
| `blocked_values` | any arg | Argument value must NOT be in list |
| `max_length` | string args | String length ≤ limit |
| `pattern` | string args | Argument must match regex pattern |

### New file: `services/runtime/capabilities.ts`

Exports:
- `checkCapability(capability, toolName, toolArgs, dailyCounts)` — returns `{ allowed, verdict, reason, constraint? }`
- `checkConstraint(constraintName, constraintValue, toolArgs, context)` — individual constraint check
- `getCapabilityVerdict(charter, toolName, toolArgs, dailyCounts)` — looks up capability, checks constraints, returns verdict or null (null = no capability defined, use fallback)

### Changes to charter-enforcement.js

In `validateToolCall()`, before the existing string-based logic, add:
```javascript
const capVerdict = getCapabilityVerdict(charter, toolName, toolArgs, dailyCounts);
if (capVerdict !== null) return capVerdict;
// ... existing string matching fallback
```

### Daily count tracking

`max_per_day` needs to know how many times a tool was called today. Query `worker_executions` activity for today's tool calls, or maintain an in-memory counter reset at midnight. The simpler approach: pass daily counts from the execution context.

---

## PR Breakdown

### PR 1: Capability module + tests
- New: `services/runtime/capabilities.ts`
- New: `test/runtime-capabilities.test.js`
- Modify: `services/runtime/types.ts` — add Capability types

### PR 2: Wire into charter enforcement
- Modify: `services/runtime/charter-enforcement.js` — check capabilities before string matching
- Modify: `services/runtime/server.js` — pass daily counts to validateToolCall
