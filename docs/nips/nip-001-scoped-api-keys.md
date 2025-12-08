# NIP-001: Scoped API Keys

| Field | Value |
|-------|-------|
| NIP | 001 |
| Title | Scoped API Keys |
| Author | Nooterra Team |
| Status | Draft |
| Created | 2025-12-07 |
| Updated | 2025-12-07 |

## Abstract

API keys should support granular, fine-grained permissions to limit access to specific resources and operations. This allows organizations to create least-privilege API keys for different use cases (billing-only, read-only, agent management).

## Motivation

Currently, API keys in Nooterra are all-or-nothing per project. A key either has full access to all resources or no access at all. This creates security risks:

1. **Over-privileged keys** - A billing system only needs read access to invoices, but currently gets write access to workflows
2. **No audit separation** - Cannot distinguish between keys used for different purposes
3. **Blast radius** - A compromised key has full project access

## Specification

### Scope Definition

```typescript
interface ApiKeyScope {
  /** Resource type this scope applies to */
  resource: 'agents' | 'workflows' | 'ledger' | 'billing' | 'webhooks' | 'policies' | '*';
  
  /** Allowed actions on this resource */
  actions: ('read' | 'write' | 'delete' | 'execute')[];
  
  /** Optional: specific resource IDs (for agent-specific access) */
  resourceIds?: string[];
}

interface ApiKey {
  id: string;
  projectId: number;
  keyHash: string;
  label: string;
  scopes: ApiKeyScope[];
  createdAt: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
}
```

### Predefined Scope Sets

```typescript
const SCOPE_PRESETS = {
  // Full project access (backwards compatible)
  'admin': [
    { resource: '*', actions: ['read', 'write', 'delete', 'execute'] }
  ],
  
  // Read-only access to all resources
  'readonly': [
    { resource: '*', actions: ['read'] }
  ],
  
  // Billing integration
  'billing': [
    { resource: 'ledger', actions: ['read'] },
    { resource: 'billing', actions: ['read', 'write'] }
  ],
  
  // Workflow execution only
  'executor': [
    { resource: 'workflows', actions: ['read', 'write', 'execute'] }
  ],
  
  // Agent management
  'agent-admin': [
    { resource: 'agents', actions: ['read', 'write', 'delete'] }
  ]
};
```

### API Changes

#### Create API Key with Scopes

```http
POST /v1/projects/:projectId/api-keys
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "label": "billing-integration",
  "scopes": [
    { "resource": "ledger", "actions": ["read"] },
    { "resource": "billing", "actions": ["read"] }
  ],
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

Response:
```json
{
  "id": "key_abc123",
  "key": "noot_live_xxxxxxxxxxxx",
  "label": "billing-integration",
  "scopes": [...],
  "createdAt": "2025-12-07T00:00:00Z",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

> **Note**: The raw key is only returned once. Store it securely.

#### Scope Enforcement

Every API endpoint checks the scope before processing:

```typescript
function requireScope(resource: string, action: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.apiKey;
    
    if (!apiKey) {
      return reply.status(401).send({ error: 'api_key_required' });
    }
    
    const hasPermission = apiKey.scopes.some(scope => 
      (scope.resource === '*' || scope.resource === resource) &&
      scope.actions.includes(action)
    );
    
    if (!hasPermission) {
      return reply.status(403).send({ 
        error: 'insufficient_scope',
        required: { resource, action },
        message: `API key lacks '${action}' permission on '${resource}'`
      });
    }
  };
}

// Usage in routes
app.get('/v1/workflows', {
  preHandler: [apiGuard, requireScope('workflows', 'read')]
}, handler);

app.post('/v1/workflows', {
  preHandler: [apiGuard, requireScope('workflows', 'write')]
}, handler);

app.post('/v1/workflows/:id/trigger', {
  preHandler: [apiGuard, requireScope('workflows', 'execute')]
}, handler);
```

### Database Changes

```sql
-- Add scopes column to existing api_keys table
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scopes JSONB DEFAULT '[]';

-- Add expiration tracking
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Migrate existing keys to have admin scope (backwards compatible)
UPDATE api_keys 
SET scopes = '[{"resource": "*", "actions": ["read", "write", "delete", "execute"]}]'::jsonb
WHERE scopes = '[]'::jsonb OR scopes IS NULL;

-- Index for quick lookup
CREATE INDEX IF NOT EXISTS ix_api_keys_project_active 
ON api_keys(project_id) 
WHERE revoked_at IS NULL;
```

### Error Responses

```json
// Missing required scope
{
  "error": "insufficient_scope",
  "required": {
    "resource": "workflows",
    "action": "write"
  },
  "message": "API key lacks 'write' permission on 'workflows'"
}

// Expired key
{
  "error": "api_key_expired",
  "expiredAt": "2024-12-01T00:00:00Z"
}
```

## Rationale

### Why JSONB for scopes?

- Flexible schema evolution
- No joins required
- Easy to query with Postgres operators
- Can add new resources without migrations

### Why not role-based (RBAC)?

Roles add complexity. Direct scope assignment is:
- Simpler to implement
- Easier to audit
- More flexible for custom permissions

### Why `execute` as separate from `write`?

Creating a workflow definition (write) is different from triggering execution (execute). This allows:
- CI/CD systems to define workflows but not run them
- Operators to run workflows but not modify them

## Backwards Compatibility

Existing API keys without explicit scopes will be treated as having `admin` scope (full access). This ensures no breaking changes.

```typescript
function getEffectiveScopes(apiKey: ApiKey): ApiKeyScope[] {
  if (!apiKey.scopes || apiKey.scopes.length === 0) {
    return [{ resource: '*', actions: ['read', 'write', 'delete', 'execute'] }];
  }
  return apiKey.scopes;
}
```

## Security Considerations

1. **Key Storage**: Continue to hash keys with SHA-256 before storage
2. **Scope Expansion**: Never allow a key to grant more permissions than it has
3. **Audit Trail**: Log all scope checks for security auditing
4. **Rotation**: Encourage key rotation with `expiresAt` field

## Reference Implementation

See PR: `#XXX` (to be created)

Key files:
- `apps/coordinator/src/core/api-guard.ts` - Scope enforcement middleware
- `apps/coordinator/src/routes/api-keys.ts` - Key management API
- `apps/coordinator/src/db.ts` - Database migration

## Copyright

This document is placed in the public domain.
