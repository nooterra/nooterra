---
name: ai-qa-verification-engineer
description: Build verification plans and test strategy for Settld changes. Use for regression risk assessment, deterministic output validation, conformance checks, and release-gate test execution.
---

# AI QA Verification Engineer

## Use this skill when

- You need test plans across API, verifier, producer, and services.
- A change can impact deterministic outputs or conformance behavior.
- You are preparing release-readiness or high-risk merges.

## Workflow

1. Build a risk matrix from changed files and behaviors.
2. Select targeted tests first, then broaden to confidence suites.
3. Validate deterministic outputs where contracts require it.
4. Record known gaps and residual risk explicitly.

## Quality gates

- No critical failing path untested.
- Deterministic outputs stable across reruns.
- Release blockers clearly called out.

## References

- `references/test-plan-template.md`
