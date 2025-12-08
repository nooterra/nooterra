/**
 * Scope Enforcement Tests
 * 
 * Tests for NIP-001: Scoped API Keys
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    hasPermission,
    parseLegacyScopes,
    requireScope,
    ApiKeyScope,
    SCOPE_PRESETS,
} from './scope-enforcement.js';

describe('Scope Enforcement', () => {
    describe('parseLegacyScopes', () => {
        it('should return admin scopes for null/undefined', () => {
            expect(parseLegacyScopes(null)).toEqual(SCOPE_PRESETS.admin);
            expect(parseLegacyScopes(undefined)).toEqual(SCOPE_PRESETS.admin);
        });

        it('should convert legacy ["*"] to admin scopes', () => {
            const result = parseLegacyScopes(['*']);
            expect(result).toEqual(SCOPE_PRESETS.admin);
        });

        it('should convert legacy action strings to scope object', () => {
            const result = parseLegacyScopes(['read', 'write']);
            expect(result).toHaveLength(1);
            expect(result[0].resource).toBe('*');
            expect(result[0].actions).toContain('read');
            expect(result[0].actions).toContain('write');
        });

        it('should pass through new format unchanged', () => {
            const newFormat: ApiKeyScope[] = [
                { resource: 'workflows', actions: ['read', 'execute'] },
            ];
            const result = parseLegacyScopes(newFormat);
            expect(result).toEqual(newFormat);
        });
    });

    describe('hasPermission', () => {
        it('should allow wildcard resource access', () => {
            const scopes: ApiKeyScope[] = [
                { resource: '*', actions: ['read', 'write', 'delete', 'execute'] },
            ];

            expect(hasPermission(scopes, 'workflows', 'read')).toBe(true);
            expect(hasPermission(scopes, 'agents', 'write')).toBe(true);
            expect(hasPermission(scopes, 'ledger', 'delete')).toBe(true);
        });

        it('should deny when action not in scope', () => {
            const scopes: ApiKeyScope[] = [
                { resource: 'workflows', actions: ['read'] },
            ];

            expect(hasPermission(scopes, 'workflows', 'read')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'write')).toBe(false);
            expect(hasPermission(scopes, 'workflows', 'delete')).toBe(false);
        });

        it('should deny when resource not in scope', () => {
            const scopes: ApiKeyScope[] = [
                { resource: 'workflows', actions: ['read', 'write'] },
            ];

            expect(hasPermission(scopes, 'workflows', 'read')).toBe(true);
            expect(hasPermission(scopes, 'agents', 'read')).toBe(false);
            expect(hasPermission(scopes, 'ledger', 'read')).toBe(false);
        });

        it('should check resource IDs when specified', () => {
            const scopes: ApiKeyScope[] = [
                {
                    resource: 'workflows',
                    actions: ['read', 'execute'],
                    resourceIds: ['wf-123', 'wf-456'],
                },
            ];

            expect(hasPermission(scopes, 'workflows', 'read', 'wf-123')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'read', 'wf-456')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'read', 'wf-789')).toBe(false);
        });

        it('should allow multiple scopes', () => {
            const scopes: ApiKeyScope[] = [
                { resource: 'workflows', actions: ['read'] },
                { resource: 'agents', actions: ['read', 'write'] },
                { resource: 'ledger', actions: ['read'] },
            ];

            expect(hasPermission(scopes, 'workflows', 'read')).toBe(true);
            expect(hasPermission(scopes, 'agents', 'write')).toBe(true);
            expect(hasPermission(scopes, 'ledger', 'read')).toBe(true);
            expect(hasPermission(scopes, 'ledger', 'write')).toBe(false);
        });
    });

    describe('SCOPE_PRESETS', () => {
        it('admin should have full access', () => {
            const scopes = SCOPE_PRESETS.admin as ApiKeyScope[];

            expect(hasPermission(scopes, 'workflows', 'read')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'write')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'delete')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'execute')).toBe(true);
            expect(hasPermission(scopes, 'agents', 'write')).toBe(true);
        });

        it('readonly should only allow read', () => {
            const scopes = SCOPE_PRESETS.readonly as ApiKeyScope[];

            expect(hasPermission(scopes, 'workflows', 'read')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'write')).toBe(false);
            expect(hasPermission(scopes, 'agents', 'read')).toBe(true);
            expect(hasPermission(scopes, 'agents', 'delete')).toBe(false);
        });

        it('billing should only access ledger and billing', () => {
            const scopes = SCOPE_PRESETS.billing as ApiKeyScope[];

            expect(hasPermission(scopes, 'ledger', 'read')).toBe(true);
            expect(hasPermission(scopes, 'ledger', 'write')).toBe(false);
            expect(hasPermission(scopes, 'billing', 'read')).toBe(true);
            expect(hasPermission(scopes, 'billing', 'write')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'read')).toBe(false);
        });

        it('executor should read, write, and execute workflows', () => {
            const scopes = SCOPE_PRESETS.executor as ApiKeyScope[];

            expect(hasPermission(scopes, 'workflows', 'read')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'write')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'execute')).toBe(true);
            expect(hasPermission(scopes, 'workflows', 'delete')).toBe(false);
            expect(hasPermission(scopes, 'agents', 'read')).toBe(false);
        });
    });

    describe('requireScope middleware', () => {
        const mockReply = () => ({
            status: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis(),
        });

        it('should allow super users', async () => {
            const reply = mockReply();
            const request = {
                method: 'GET',
                auth: { isSuper: true, projectId: null },
            } as any;

            const middleware = requireScope('workflows', 'read');
            await middleware(request, reply as any);

            expect(reply.status).not.toHaveBeenCalled();
        });

        it('should deny unauthenticated requests', async () => {
            const reply = mockReply();
            const request = { method: 'GET' } as any;

            const middleware = requireScope('workflows', 'read');
            await middleware(request, reply as any);

            expect(reply.status).toHaveBeenCalledWith(401);
        });

        it('should check scopes for regular users', async () => {
            const reply = mockReply();
            const request = {
                method: 'GET',
                params: {},
                auth: {
                    isSuper: false,
                    projectId: 'proj-123',
                    scopes: [{ resource: 'agents', actions: ['read'] }],
                },
            } as any;

            const middleware = requireScope('workflows', 'read');
            await middleware(request, reply as any);

            expect(reply.status).toHaveBeenCalledWith(403);
            expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
                error: 'insufficient_scope',
            }));
        });

        it('should allow matching scopes', async () => {
            const reply = mockReply();
            const request = {
                method: 'GET',
                params: {},
                auth: {
                    isSuper: false,
                    projectId: 'proj-123',
                    scopes: [{ resource: 'workflows', actions: ['read', 'write'] }],
                },
            } as any;

            const middleware = requireScope('workflows', 'read');
            await middleware(request, reply as any);

            expect(reply.status).not.toHaveBeenCalled();
        });

        it('should limit playground to read and execute only', async () => {
            const reply = mockReply();
            const request = {
                method: 'DELETE',
                params: {},
                auth: { isSuper: false, projectId: null, isPlayground: true },
            } as any;

            const middleware = requireScope('workflows');
            await middleware(request, reply as any);

            expect(reply.status).toHaveBeenCalledWith(403);
            expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
                error: 'playground_readonly',
            }));
        });
    });
});
