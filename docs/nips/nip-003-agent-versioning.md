# NIP-003: Agent Versioning & Deprecation

| Field | Value |
|-------|-------|
| NIP | 003 |
| Title | Agent Versioning & Deprecation |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |

## Abstract

Agents should be able to publish multiple versions of their capabilities and deprecate old ones with clear migration paths.

## Motivation

Without versioning:
- Breaking changes affect all callers immediately
- No graceful deprecation period
- Callers can't pin to specific versions
- No way to communicate migration paths

## Specification

### Agent Version Structure

```typescript
interface AgentVersion {
  version: string;                    // semver "1.2.3"
  status: 'active' | 'deprecated' | 'sunset';
  publishedAt: string;               // ISO date
  sunsetDate?: string;               // When version becomes unusable
  migrationPath?: string;            // DID of replacement agent/version
  changelog?: string;                // What changed from previous
  capabilities: string[];            // Capabilities at this version
}
```

### Agent Card Extension

```json
{
  "did": "did:noot:agent:summarizer",
  "name": "Text Summarizer",
  "versions": {
    "2.0.0": {
      "status": "active",
      "publishedAt": "2024-12-01",
      "capabilities": ["cap.summarize.v2"]
    },
    "1.0.0": {
      "status": "deprecated",
      "publishedAt": "2024-06-01",
      "sunsetDate": "2025-03-01",
      "migrationPath": "did:noot:agent:summarizer@2.0.0",
      "capabilities": ["cap.summarize.v1"]
    }
  },
  "defaultVersion": "2.0.0"
}
```

### API Changes

#### Register Agent Version

```http
POST /v1/agents/:did/versions
Content-Type: application/json

{
  "version": "2.1.0",
  "capabilities": ["cap.summarize.v2"],
  "changelog": "Added streaming support"
}
```

#### Deprecate Version

```http
POST /v1/agents/:did/versions/:version/deprecate
Content-Type: application/json

{
  "sunsetDate": "2025-06-01",
  "migrationPath": "did:noot:agent:summarizer@3.0.0",
  "reason": "Security vulnerability in input parsing"
}
```

#### Request Specific Version

```http
POST /v1/workflows
Content-Type: application/json

{
  "nodes": [{
    "name": "summarize",
    "capability": "cap.summarize.v2",
    "agentVersion": "~2.0.0"  // semver range
  }]
}
```

### Sunset Behavior

1. **Active**: Normal operation
2. **Deprecated**: Warning in response headers + logs
3. **Sunset (past date)**: Return 410 Gone with migration info

```json
{
  "error": "version_sunset",
  "message": "Version 1.0.0 was sunset on 2025-03-01",
  "sunsetDate": "2025-03-01",
  "migration": {
    "newVersion": "2.0.0",
    "newAgent": "did:noot:agent:summarizer@2.0.0"
  }
}
```

### Database Schema

```sql
CREATE TABLE agent_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_did TEXT NOT NULL REFERENCES agents(did),
  version TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  capabilities TEXT[] NOT NULL,
  endpoint TEXT NOT NULL,
  changelog TEXT,
  sunset_date TIMESTAMPTZ,
  migration_path TEXT,
  published_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_did, version)
);

CREATE INDEX ix_agent_versions_capability 
ON agent_versions USING GIN(capabilities);
```

## Rationale

### Why semver?

Industry standard, well-understood semantics:
- MAJOR: Breaking changes
- MINOR: New features, backward compatible
- PATCH: Bug fixes

### Why allow version ranges?

Flexibility for callers:
- `1.2.3` - Exact version
- `~1.2.0` - Allow patch updates
- `^1.0.0` - Allow minor updates
- `>=2.0.0` - Minimum version

## Security Considerations

- Version claims must be verified
- Rate limit version registration
- Audit trail for version changes

## Copyright

Public domain.
