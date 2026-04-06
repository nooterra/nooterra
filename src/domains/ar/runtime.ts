// src/domains/ar/runtime.ts
//
// AR-specific runtime provisioning — thin wrapper over the AR collections
// agent template. When domain #2 arrives, provisioning for each domain
// lives in its own domain pack.

import {
  COLLECTIONS_TOOLS,
  createCollectionsAgent,
  createCollectionsGrant,
} from '../../agents/templates/ar-collections.js';

export { COLLECTIONS_TOOLS, createCollectionsAgent, createCollectionsGrant };

/**
 * Provision the AR collections runtime for a tenant.
 * Returns the agent config, grant, and tools needed to start collections.
 */
export function provisionArRuntime(tenantId: string, agentId: string, grantorId: string) {
  return {
    agent: createCollectionsAgent(tenantId, agentId),
    grant: createCollectionsGrant(tenantId, grantorId, agentId),
    tools: COLLECTIONS_TOOLS,
  };
}

/**
 * Get the AR collections tool definitions.
 */
export function getArCollectionsTools() {
  return COLLECTIONS_TOOLS;
}
