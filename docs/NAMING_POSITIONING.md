# Naming + Positioning Decision Memo (NOO-141)

## Why This Exists
User concern: `nooterra` reads as "settlement/payments only", while the product is broader: a neutral trust + verification + policy + receipts control plane that enables safe agentic commerce and inter-agent collaboration.

This memo is about **brand clarity** (what people think this is in 5 seconds) without introducing unnecessary migration risk.

## Constraints (Non-Negotiable Reality)
1. `nooterra` already exists as a CLI/package name and is embedded in:
   - MCP tool surface (`nooterra.*`)
   - OpenClaw skill slug(s) and docs
   - API headers (`x-nooterra-*`) and artifacts/specs
2. Renaming the npm package and headers is high risk:
   - Breaks installs, scripts, and host integrations
   - Creates long-tail confusion in the ecosystem
3. We can change **product language** (README/docs/site) with near-zero risk.

## Decision Criteria
We should only rename if it materially improves one of:
1. **Comprehension**: builders immediately understand "what is this?"
2. **Scope accuracy**: it's not misfiled as "just payments"
3. **Searchability**: easy to find and distinct from generic terms
4. **Pronounceability**: people can say it on calls and in podcasts
5. **Compatibility**: minimal migration/breakage

## What We Actually Are (One Sentence)
**Nooterra is a deterministic trust plane for agents: policy-gated execution + verify-before-release settlement + verifiable receipts + recourse.**

If the name doesn’t carry that meaning, the tagline must.

## Options

### Option A (Recommended): Keep `nooterra` Name, Tighten Positioning Everywhere
Keep:
* Repo name, npm package: `nooterra`
* CLI: `nooterra`
* MCP tool namespace: `nooterra.*`
* Header namespace: `x-nooterra-*`

Change:
* Public-facing product name: **Nooterra Trust OS** (or **Nooterra Trust Plane**)
* Primary tagline everywhere (README, docs overview, ClawHub listing):
  - "Deterministic trust + settlement control plane for agent actions."
* First 3 bullets in README (no protocol jargon):
  - "Policy-gated execution (allow/challenge/deny/escalate)"
  - "Verify-before-release (hold -> verify -> release/refund)"
  - "Verifiable receipts + disputes/reversals"

Why this works:
* Zero migration risk.
* “Nooterra” can stay as the short brand, while "Trust OS" communicates scope.

### Option B: Keep Package `nooterra`, Introduce a Product Brand Name
Example:
* Product brand: **Proofplane** (example placeholder)
* Package/tooling stays `nooterra` (like "Terraform by HashiCorp" style)

Pros:
* Lets marketing choose a name that doesn’t read “payments only”.
* No breaking changes to integrations.

Cons:
* Adds a second name to explain.
* Usually only worth it once there’s a website and consistent branding.

### Option C: Full Rename (Not Recommended Right Now)
Rename repo + npm package + headers + tool namespace.

This is only justified if:
* We have a large, clear distribution advantage from the new name, and
* We’re willing to absorb weeks of ecosystem migration pain.

## Recommendation
**Choose Option A now.**

Treat `nooterra` as the short brand, and consistently present it as:
* **Nooterra Trust OS**
* "Trust plane between agent runtimes"
* "Receipts + policy + verify-before-release"

Re-evaluate after:
* The OpenClaw skill has meaningful adoption, and
* The "Agent Substrate" loop is being used outside our own demo harness.

## Minimal-Risk Migration Plan (If We Ever Rename)
If we later decide to change the brand name:
1. Keep npm package name `nooterra` permanently (compat).
2. Keep MCP tool namespace `nooterra.*` permanently (compat).
3. Keep `x-nooterra-*` headers permanently (wire-compat).
4. Only change:
   - README headline + website brand
   - Docs wording + diagrams
   - ClawHub skill display name/summary

If we ever must rename the package:
* Publish the new package as a thin wrapper that depends on `nooterra`.
* Keep `nooterra` in maintenance mode for at least 6-12 months.
* Provide a one-command migration (`npx <new> migrate`) and keep the old CLI working.

