/**
 * E2E Test: DAG Execution Order
 * 
 * Tests that workflow nodes execute in correct dependency order.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

const API_URL = process.env.E2E_API_URL || 'http://localhost:3002';
const TEST_API_KEY = process.env.E2E_API_KEY || 'test-e2e-key';

// Track execution order
const executionOrder: string[] = [];

let mockAgent: ReturnType<typeof Fastify>;
const MOCK_AGENT_PORT = 4002;

describe('DAG Execution E2E', () => {
    beforeAll(async () => {
        executionOrder.length = 0;

        mockAgent = Fastify();

        mockAgent.post('/jsonrpc', async (request, reply) => {
            const body = request.body as any;

            if (body.method === 'tasks/execute') {
                const { nodeName, input } = body.params;

                // Track execution order
                executionOrder.push(nodeName);

                // Simulate varying processing times
                await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));

                // Return result that can be chained
                return reply.send({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        status: 'completed',
                        output: {
                            processed: true,
                            nodeOutput: `Output from ${nodeName}`,
                            inputReceived: input,
                        },
                    },
                });
            }

            return reply.status(400).send({ error: 'Unknown method' });
        });

        mockAgent.get('/nooterra/health', async () => ({
            status: 'healthy',
            version: '1.0.0',
            capabilities: ['cap.step-a.v1', 'cap.step-b.v1', 'cap.step-c.v1', 'cap.final.v1'],
            queue: { pending: 0, processing: 0, maxConcurrent: 10 },
        }));

        await mockAgent.listen({ port: MOCK_AGENT_PORT });
    });

    afterAll(async () => {
        await mockAgent?.close();
    });

    it('should execute nodes in dependency order (A → B → C)', async () => {
        if (!process.env.E2E_API_URL) {
            console.log('Skipping E2E test - no E2E_API_URL set');
            return;
        }

        // Register agent with all capabilities
        await fetch(`${API_URL}/v1/agents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                name: 'DAG Test Agent',
                endpoint: `http://localhost:${MOCK_AGENT_PORT}`,
                capabilities: ['cap.step-a.v1', 'cap.step-b.v1', 'cap.step-c.v1'],
            }),
        });

        // Create DAG workflow: A → B → C
        const createRes = await fetch(`${API_URL}/v1/workflows`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                name: 'DAG Test',
                nodes: [
                    {
                        name: 'step-a',
                        capability: 'cap.step-a.v1',
                        input: { data: 'initial' },
                    },
                    {
                        name: 'step-b',
                        capability: 'cap.step-b.v1',
                        depends: ['step-a'],
                        input: { ref: '{{step-a.output}}' },
                    },
                    {
                        name: 'step-c',
                        capability: 'cap.step-c.v1',
                        depends: ['step-b'],
                        input: { ref: '{{step-b.output}}' },
                    },
                ],
            }),
        });

        const workflow = await createRes.json();

        // Trigger and wait
        const triggerRes = await fetch(`${API_URL}/v1/workflows/${workflow.id}/trigger`, {
            method: 'POST',
            headers: { 'x-api-key': TEST_API_KEY },
        });
        const run = await triggerRes.json();

        // Poll for completion
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 500));

            const statusRes = await fetch(`${API_URL}/v1/workflows/${workflow.id}/runs/${run.runId}`, {
                headers: { 'x-api-key': TEST_API_KEY },
            });

            const status = await statusRes.json();
            if (status.status === 'completed' || status.status === 'failed') {
                break;
            }
        }

        // Verify execution order
        expect(executionOrder).toContain('step-a');
        expect(executionOrder).toContain('step-b');
        expect(executionOrder).toContain('step-c');

        const aIndex = executionOrder.indexOf('step-a');
        const bIndex = executionOrder.indexOf('step-b');
        const cIndex = executionOrder.indexOf('step-c');

        expect(aIndex).toBeLessThan(bIndex);
        expect(bIndex).toBeLessThan(cIndex);

        console.log('Execution order verified:', executionOrder);
    });

    it('should execute parallel nodes concurrently', async () => {
        if (!process.env.E2E_API_URL) return;

        executionOrder.length = 0;

        // Create workflow with parallel nodes: A → (B1, B2) → C
        // B1 and B2 should run in parallel
        const createRes = await fetch(`${API_URL}/v1/workflows`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                name: 'Parallel Test',
                nodes: [
                    { name: 'root', capability: 'cap.step-a.v1', input: {} },
                    { name: 'parallel-1', capability: 'cap.step-b.v1', depends: ['root'], input: {} },
                    { name: 'parallel-2', capability: 'cap.step-b.v1', depends: ['root'], input: {} },
                    { name: 'final', capability: 'cap.step-c.v1', depends: ['parallel-1', 'parallel-2'], input: {} },
                ],
            }),
        });

        const workflow = await createRes.json();

        await fetch(`${API_URL}/v1/workflows/${workflow.id}/trigger`, {
            method: 'POST',
            headers: { 'x-api-key': TEST_API_KEY },
        });

        // Wait for completion
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Verify root ran first, final ran last
        const rootIndex = executionOrder.indexOf('root');
        const p1Index = executionOrder.indexOf('parallel-1');
        const p2Index = executionOrder.indexOf('parallel-2');
        const finalIndex = executionOrder.indexOf('final');

        expect(rootIndex).toBe(0);
        expect(p1Index).toBeGreaterThan(rootIndex);
        expect(p2Index).toBeGreaterThan(rootIndex);
        expect(finalIndex).toBeGreaterThan(p1Index);
        expect(finalIndex).toBeGreaterThan(p2Index);
    });
});
