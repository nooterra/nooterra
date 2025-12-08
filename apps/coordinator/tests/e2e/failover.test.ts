/**
 * E2E Test: Agent Failover
 * 
 * Tests that the coordinator correctly fails over to backup agents.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'crypto';

const API_URL = process.env.E2E_API_URL || 'http://localhost:3002';
const TEST_API_KEY = process.env.E2E_API_KEY || 'test-e2e-key';

let primaryAgent: ReturnType<typeof Fastify>;
let backupAgent: ReturnType<typeof Fastify>;
const PRIMARY_PORT = 4004;
const BACKUP_PORT = 4005;

let primaryCalls = 0;
let backupCalls = 0;

describe('Agent Failover E2E', () => {
    beforeAll(async () => {
        // Primary agent - fails 100% of the time
        primaryAgent = Fastify();

        primaryAgent.post('/jsonrpc', async (request, reply) => {
            primaryCalls++;
            // Simulate failure
            return reply.status(500).send({ error: 'Primary agent down' });
        });

        primaryAgent.get('/nooterra/health', async () => ({
            status: 'healthy',
            version: '1.0.0',
            capabilities: ['cap.failover-test.v1'],
            queue: { pending: 0, processing: 0, maxConcurrent: 10 },
        }));

        await primaryAgent.listen({ port: PRIMARY_PORT });

        // Backup agent - always succeeds
        backupAgent = Fastify();

        backupAgent.post('/jsonrpc', async (request, reply) => {
            backupCalls++;
            const body = request.body as any;

            if (body.method === 'tasks/execute') {
                await new Promise(resolve => setTimeout(resolve, 50));

                return reply.send({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        status: 'completed',
                        output: { result: 'Backup agent succeeded' },
                    },
                });
            }

            return reply.status(400).send({ error: 'Unknown method' });
        });

        backupAgent.get('/nooterra/health', async () => ({
            status: 'healthy',
            version: '1.0.0',
            capabilities: ['cap.failover-test.v1'],
            queue: { pending: 0, processing: 0, maxConcurrent: 10 },
        }));

        await backupAgent.listen({ port: BACKUP_PORT });
    });

    afterAll(async () => {
        await primaryAgent?.close();
        await backupAgent?.close();
    });

    it('should failover to backup agent when primary fails', async () => {
        if (!process.env.E2E_API_URL) {
            console.log('Skipping E2E test - no E2E_API_URL set');
            return;
        }

        primaryCalls = 0;
        backupCalls = 0;

        // Register both agents with same capability
        await fetch(`${API_URL}/v1/agents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                name: 'Primary Agent (Failing)',
                endpoint: `http://localhost:${PRIMARY_PORT}`,
                capabilities: ['cap.failover-test.v1'],
            }),
        });

        await fetch(`${API_URL}/v1/agents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                name: 'Backup Agent (Reliable)',
                endpoint: `http://localhost:${BACKUP_PORT}`,
                capabilities: ['cap.failover-test.v1'],
            }),
        });

        // Create and trigger workflow
        const workflowId = `failover-test-${randomUUID()}`;
        await fetch(`${API_URL}/v1/workflows`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                id: workflowId,
                name: 'Failover Test',
                nodes: [{
                    name: 'test',
                    capability: 'cap.failover-test.v1',
                    input: {},
                    retries: 2, // Allow retries
                }],
            }),
        });

        const triggerRes = await fetch(`${API_URL}/v1/workflows/${workflowId}/trigger`, {
            method: 'POST',
            headers: { 'x-api-key': TEST_API_KEY },
        });
        const run = await triggerRes.json();

        // Poll for completion
        let result;
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));

            const statusRes = await fetch(`${API_URL}/v1/workflows/${workflowId}/runs/${run.runId}`, {
                headers: { 'x-api-key': TEST_API_KEY },
            });

            const status = await statusRes.json();
            if (status.status === 'completed' || status.status === 'failed') {
                result = status;
                break;
            }
        }

        console.log('Failover result:', {
            status: result?.status,
            primaryCalls,
            backupCalls
        });

        // Should have attempted primary and fallen back to backup
        expect(primaryCalls).toBeGreaterThanOrEqual(1);
        expect(backupCalls).toBeGreaterThanOrEqual(1);
        expect(result?.status).toBe('completed');
    });
});
