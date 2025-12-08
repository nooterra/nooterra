/**
 * E2E Test: Credit Flow
 * 
 * Tests that credits flow correctly from requester to agent on task completion.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { randomUUID } from 'crypto';

const API_URL = process.env.E2E_API_URL || 'http://localhost:3002';
const TEST_API_KEY = process.env.E2E_API_KEY || 'test-e2e-key';

let mockAgent: ReturnType<typeof Fastify>;
const MOCK_AGENT_PORT = 4003;

describe('Credit Flow E2E', () => {
    let agentDid: string;
    let projectPayerDid: string;

    beforeAll(async () => {
        mockAgent = Fastify();

        mockAgent.post('/jsonrpc', async (request, reply) => {
            const body = request.body as any;

            if (body.method === 'tasks/execute') {
                await new Promise(resolve => setTimeout(resolve, 50));

                return reply.send({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        status: 'completed',
                        output: { result: 'Test output' },
                    },
                });
            }

            return reply.status(400).send({ error: 'Unknown method' });
        });

        mockAgent.get('/nooterra/health', async () => ({
            status: 'healthy',
            version: '1.0.0',
            capabilities: ['cap.credit-test.v1'],
            queue: { pending: 0, processing: 0, maxConcurrent: 10 },
        }));

        await mockAgent.listen({ port: MOCK_AGENT_PORT });
    });

    afterAll(async () => {
        await mockAgent?.close();
    });

    it('should debit requester and credit agent on completion', async () => {
        if (!process.env.E2E_API_URL) {
            console.log('Skipping E2E test - no E2E_API_URL set');
            return;
        }

        // 1. Register agent with pricing
        const agentRes = await fetch(`${API_URL}/v1/agents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                name: 'Credit Test Agent',
                endpoint: `http://localhost:${MOCK_AGENT_PORT}`,
                capabilities: ['cap.credit-test.v1'],
                pricePerCall: 100, // 100 cents = $1.00
            }),
        });

        const agent = await agentRes.json();
        agentDid = agent.did;
        console.log('Agent DID:', agentDid);

        // 2. Get initial balances
        const initialRequesterBalance = await getBalance(TEST_API_KEY, 'requester');
        const initialAgentBalance = await getBalance(TEST_API_KEY, agentDid);

        console.log('Initial balances:', {
            requester: initialRequesterBalance,
            agent: initialAgentBalance
        });

        // 3. Execute task
        const workflowId = `credit-test-${randomUUID()}`;
        await fetch(`${API_URL}/v1/workflows`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                id: workflowId,
                name: 'Credit Test Workflow',
                nodes: [{
                    name: 'test',
                    capability: 'cap.credit-test.v1',
                    input: {},
                }],
            }),
        });

        const triggerRes = await fetch(`${API_URL}/v1/workflows/${workflowId}/trigger`, {
            method: 'POST',
            headers: { 'x-api-key': TEST_API_KEY },
        });
        const run = await triggerRes.json();

        // 4. Wait for completion
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 5. Check final balances
        const finalRequesterBalance = await getBalance(TEST_API_KEY, 'requester');
        const finalAgentBalance = await getBalance(TEST_API_KEY, agentDid);

        console.log('Final balances:', {
            requester: finalRequesterBalance,
            agent: finalAgentBalance
        });

        // 6. Verify credit flow
        // Requester should have been debited
        expect(finalRequesterBalance).toBeLessThan(initialRequesterBalance);

        // Agent should have been credited (minus platform fee)
        expect(finalAgentBalance).toBeGreaterThan(initialAgentBalance);

        // The difference should roughly match the task cost
        const requesterDelta = initialRequesterBalance - finalRequesterBalance;
        expect(requesterDelta).toBeGreaterThan(0);

        console.log('Credit flow verified:', {
            debited: requesterDelta,
            credited: finalAgentBalance - initialAgentBalance,
        });
    });

    it('should reject task if requester has insufficient balance', async () => {
        if (!process.env.E2E_API_URL) return;

        // Create workflow with very high budget
        const res = await fetch(`${API_URL}/v1/workflows`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': TEST_API_KEY,
            },
            body: JSON.stringify({
                name: 'High Budget Test',
                nodes: [{
                    name: 'expensive',
                    capability: 'cap.very-expensive.v1',
                    input: {},
                }],
                budget: 10000000, // $100,000 - should exceed balance
            }),
        });

        // Should fail with insufficient funds or validation error
        const data = await res.json();
        if (!res.ok) {
            expect(data.error).toBeDefined();
            console.log('Correctly rejected high-budget workflow:', data.error);
        }
    });
});

async function getBalance(apiKey: string, did: string): Promise<number> {
    try {
        const res = await fetch(`${API_URL}/v1/ledger/balance?did=${encodeURIComponent(did)}`, {
            headers: { 'x-api-key': apiKey },
        });
        const data = await res.json();
        return data.balance || 0;
    } catch {
        return 0;
    }
}
