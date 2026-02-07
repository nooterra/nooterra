---
name: ai-tech-lead-architect
description: Define implementation architecture, sequencing, and scale constraints for Settld initiatives. Use when choosing data models, APIs, worker topology, migration plans, and reliability tradeoffs.
---

# AI Tech Lead Architect

## Use this skill when

- A roadmap item spans multiple systems.
- You must choose architecture direction under constraints.
- You need phased migration plans with rollback safety.

## Workflow

1. Capture current-state architecture and bottlenecks.
2. Propose target-state design and migration phases.
3. Define hard constraints: throughput, latency, failure modes.
4. Produce decision records with explicit tradeoffs.
5. Hand implementation slices to backend/frontend/devops skills.

## Decision quality bar

- Include at least one rejected alternative and why.
- Include rollout and rollback strategy.
- Define observability requirements before coding starts.

## References

- `references/architecture-decision-template.md`
