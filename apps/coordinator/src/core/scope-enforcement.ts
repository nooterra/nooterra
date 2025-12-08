/**
 * Scope Enforcement Module
 * 
 * NIP-001 Implementation: Scoped API Keys
 * 
 * This module provides middleware for enforcing fine-grained permissions
 * on API keys based on resource type and action.
 */

import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Defines a permission scope for an API key.
 */
export interface ApiKeyScope {
    /** Resource type this scope applies to */
    resource: 'agents' | 'workflows' | 'ledger' | 'billing' | 'webhooks' | 'policies' | 'templates' | 'bounties' | 'federation' | '*';

    /** Allowed actions on this resource */
    actions: ('read' | 'write' | 'delete' | 'execute')[];

    /** Optional: specific resource IDs for fine-grained access */
    resourceIds?: string[];
}

/**
 * Auth context attached to requests
 */
export interface AuthContext {
    isSuper: boolean;
    projectId: string | number | null;
    scopes?: ApiKeyScope[];
    isPlayground?: boolean;
    payerDid?: string;
}

/**
 * Predefined scope sets for common use cases
 */
export const SCOPE_PRESETS: Record<string, ApiKeyScope[]> = {
    /** Full project access (backwards compatible with old keys) */
    admin: [{ resource: '*', actions: ['read', 'write', 'delete', 'execute'] }],

    /** Read-only access to all resources */
    readonly: [{ resource: '*', actions: ['read'] }],

    /** Billing/finance integration */
    billing: [
        { resource: 'ledger', actions: ['read'] },
        { resource: 'billing', actions: ['read', 'write'] },
    ],

    /** Workflow execution only (CI/CD pipelines) */
    executor: [
        { resource: 'workflows', actions: ['read', 'write', 'execute'] },
    ],

    /** Agent management */
    agentAdmin: [
        { resource: 'agents', actions: ['read', 'write', 'delete'] },
    ],

    /** Template browsing */
    templateReader: [
        { resource: 'templates', actions: ['read'] },
    ],
};

/**
 * Map HTTP methods to actions
 */
function methodToAction(method: string): 'read' | 'write' | 'delete' | 'execute' {
    switch (method.toUpperCase()) {
        case 'GET':
        case 'HEAD':
        case 'OPTIONS':
            return 'read';
        case 'POST':
            return 'write'; // POST can also be 'execute' for triggers
        case 'PUT':
        case 'PATCH':
            return 'write';
        case 'DELETE':
            return 'delete';
        default:
            return 'write';
    }
}

/**
 * Parse legacy scope format for backwards compatibility.
 * Old format: ["*"] or ["read", "write"]
 * New format: [{resource: "*", actions: ["read", "write"]}]
 */
export function parseLegacyScopes(scopes: unknown): ApiKeyScope[] {
    if (!scopes) {
        // Default: full access for backwards compatibility
        return SCOPE_PRESETS.admin;
    }

    if (!Array.isArray(scopes)) {
        return SCOPE_PRESETS.admin;
    }

    // Check if it's legacy format (array of strings)
    if (scopes.length > 0 && typeof scopes[0] === 'string') {
        // Legacy: ["*"] means admin
        if (scopes.includes('*')) {
            return SCOPE_PRESETS.admin;
        }
        // Legacy: convert action strings to scope object
        return [{
            resource: '*',
            actions: scopes as ('read' | 'write' | 'delete' | 'execute')[],
        }];
    }

    // Already new format
    return scopes as ApiKeyScope[];
}

/**
 * Check if the given scopes allow access to a resource with the specified action.
 */
export function hasPermission(
    scopes: ApiKeyScope[],
    resource: string,
    action: 'read' | 'write' | 'delete' | 'execute',
    resourceId?: string
): boolean {
    for (const scope of scopes) {
        // Check resource match
        const resourceMatch = scope.resource === '*' || scope.resource === resource;
        if (!resourceMatch) continue;

        // Check action match
        const actionMatch = scope.actions.includes(action);
        if (!actionMatch) continue;

        // Check resource ID if specified
        if (scope.resourceIds && resourceId) {
            if (!scope.resourceIds.includes(resourceId)) continue;
        }

        return true;
    }

    return false;
}

/**
 * Create a scope enforcement middleware for a specific resource.
 * 
 * Usage:
 * ```
 * app.get('/v1/workflows', {
 *   preHandler: [apiGuard, requireScope('workflows', 'read')]
 * }, handler);
 * ```
 */
export function requireScope(
    resource: string,
    action?: 'read' | 'write' | 'delete' | 'execute'
) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const auth = (request as any).auth as AuthContext | undefined;

        // No auth context = not authenticated
        if (!auth) {
            return reply.status(401).send({ error: 'authentication_required' });
        }

        // Super/admin keys have full access
        if (auth.isSuper) {
            return;
        }

        // Playground mode has limited access
        if (auth.isPlayground) {
            // Allow only read operations in playground
            const effectiveAction = action || methodToAction(request.method);
            if (effectiveAction !== 'read' && effectiveAction !== 'execute') {
                return reply.status(403).send({
                    error: 'playground_readonly',
                    message: 'Playground keys can only read data and execute workflows',
                });
            }
            return;
        }

        // No scopes = legacy key with full access
        if (!auth.scopes || auth.scopes.length === 0) {
            return;
        }

        // Determine the action (from parameter or HTTP method)
        const effectiveAction = action || methodToAction(request.method);

        // Extract resource ID from params if available
        const params = request.params as Record<string, string>;
        const resourceId = params?.id || params?.did || params?.workflowId;

        // Check permission
        if (!hasPermission(auth.scopes, resource, effectiveAction, resourceId)) {
            return reply.status(403).send({
                error: 'insufficient_scope',
                required: { resource, action: effectiveAction },
                message: `API key lacks '${effectiveAction}' permission on '${resource}'`,
            });
        }
    };
}

/**
 * Require 'execute' permission for trigger endpoints.
 * This is a special case where POST should mean 'execute' not 'write'.
 */
export function requireExecuteScope(resource: string) {
    return requireScope(resource, 'execute');
}

/**
 * Log scope check for audit trail.
 */
export function logScopeCheck(
    logger: { info: (obj: any, msg?: string) => void },
    resource: string,
    action: string,
    allowed: boolean,
    auth: AuthContext
) {
    logger.info({
        event: 'scope_check',
        resource,
        action,
        allowed,
        projectId: auth.projectId,
        isSuper: auth.isSuper,
    });
}
