# GitHub Tracking Source Of Truth (2026-03-01)

As of 2026-03-01, planning and execution tracking for Nooterra is GitHub-first.

## Decision
- Linear is no longer the active source of truth for sprint execution.
- GitHub Issues/PRs are now authoritative for active work tracking.

## Migration Outcome
- Open Linear issues were migrated to GitHub issues with preserved `NOO-*` identifiers in titles.
- Open Linear issues were marked canceled with comments pointing to their matching GitHub issue links.
- A deterministic migration mapping artifact was produced:
  - `docs/planning/linear-to-github-open-issue-migration-2026-03-01.json`

## Operational Guardrails
- Keep `NOO-*` identifier in title for continuity.
- Link PRs to GitHub issues as source of planning truth.
- Do not create new active planning items in Linear.

## Local Tooling
- Linear MCP connection was removed from local Codex config (`~/.codex/config.toml`).
- If a shell/session still has Linear MCP loaded, restart Codex.
