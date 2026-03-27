/**
 * Chat Endpoint
 *
 * Proxies conversations through OpenRouter with streaming SSE responses.
 * Mounted in the scheduler's HTTP server as POST /v1/chat.
 * Tracks token usage and deducts from tenant_credits.
 */

import { chatCompletion, estimateCost } from './openrouter.js';

const NOOTERRA_SYSTEM_PROMPT = `You are Nooterra. When a user describes their business, generate a complete AI team proposal in a single response.

OUTPUT FORMAT — always respond with this exact structure:

[TEAM_PROPOSAL]
team_name: [Business Name] Team
worker: Reception
title: [1-line job title]
description: [1 sentence about what this worker does]
canDo: [comma-separated list of 4-6 things it can do autonomously]
askFirst: [comma-separated list of 2-4 things that need approval]
neverDo: [comma-separated list of 2-4 hard limits]
schedule: continuous

worker: [Next Worker Name]
title: [title]
description: [description]
canDo: [list]
askFirst: [list]
neverDo: [list]
schedule: continuous
[/TEAM_PROPOSAL]

RULES:
- Generate 3-6 workers based on the business type and size
- Each worker should have a clear, distinct role
- Rules should be SPECIFIC to their business, not generic
- canDo rules: things the worker handles without asking
- askFirst rules: sensitive actions that pause for human approval
- neverDo rules: hard boundaries that are blocked
- If the user mentions specific tools (ServiceTitan, QuickBooks, etc.), reference them
- If the user mentions specializations, reflect them in the rules
- Keep descriptions short and concrete
- Generate the ENTIRE team in ONE response — do not ask follow-up questions
- After the [TEAM_PROPOSAL] block, add a brief 1-2 sentence summary

For general conversation (not team creation), respond normally and helpfully.`;

function generateId(prefix = 'chat') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, msg });
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

/**
 * Handle a chat request: stream an OpenRouter completion back as SSE.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {import('pg').Pool} pool
 */
export async function handleChatRequest(req, res, pool) {
  // Parse request body
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  const { messages, model } = parsed;
  const tenantId = req.headers['x-tenant-id'] || parsed.tenantId;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'messages array is required' }));
    return;
  }

  if (!tenantId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'tenantId is required (header x-tenant-id or body field)' }));
    return;
  }

  const selectedModel = model || 'nvidia/nemotron-3-super-120b-a12b:free';

  // Check tenant credits (skip for free models)
  const isFreeModel = selectedModel.includes(':free');
  if (!isFreeModel) {
    try {
      const creditResult = await pool.query(
        'SELECT balance_usd FROM tenant_credits WHERE tenant_id = $1',
        [tenantId]
      );
      const balance = creditResult.rows[0]?.balance_usd ?? 0;
      if (parseFloat(balance) <= 0) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "You're out of credits. Top up to continue, or switch to a free model." }));
        return;
      }
    } catch (err) {
      log('error', `Credit check failed for tenant ${tenantId}: ${err.message}`);
      // Allow chat to proceed if credit check fails (table may not exist yet)
    }
  }

  // Prepend system message
  const fullMessages = [
    { role: 'system', content: NOOTERRA_SYSTEM_PROMPT },
    ...messages.filter(m => m.role !== 'system' || m.content !== NOOTERRA_SYSTEM_PROMPT),
  ];

  // Set up SSE response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    const stream = await chatCompletion({
      model: selectedModel,
      messages: fullMessages,
      maxTokens: 4096,
      temperature: 0.7,
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'token') {
        // Forward as OpenAI-compatible SSE
        const sseData = JSON.stringify({
          choices: [{ delta: { content: event.content }, index: 0 }],
        });
        res.write(`data: ${sseData}\n\n`);
      } else if (event.type === 'done') {
        // Send final done signal
        res.write('data: [DONE]\n\n');

        // Track usage in background
        const { usage } = event;
        trackUsage(pool, tenantId, selectedModel, usage, generateId('chat')).catch(err => {
          log('error', `Failed to track chat usage for tenant ${tenantId}: ${err.message}`);
        });

        log('info', `Chat completion for tenant ${tenantId}: ${usage.totalTokens} tokens, $${usage.cost.toFixed(6)}`);
      }
    }
  } catch (err) {
    log('error', `Chat stream error for tenant ${tenantId}: ${err.message}`);
    // Try to send error as SSE if headers were already sent
    try {
      const errorData = JSON.stringify({ error: err.message });
      res.write(`data: ${errorData}\n\n`);
      res.write('data: [DONE]\n\n');
    } catch { /* response may already be closed */ }
  }

  res.end();
}

/**
 * Track token usage and deduct credits.
 */
async function trackUsage(pool, tenantId, model, usage, chatId) {
  if (!usage || usage.cost <= 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE tenant_credits SET
        balance_usd = balance_usd - $2,
        total_spent_usd = total_spent_usd + $2,
        updated_at = now()
      WHERE tenant_id = $1
    `, [tenantId, usage.cost]);

    await client.query(`
      INSERT INTO credit_transactions (id, tenant_id, amount_usd, type, description, created_at)
      VALUES ($1, $2, $3, 'chat_charge', $4, now())
    `, [
      chatId,
      tenantId,
      -usage.cost,
      `Chat: ${model} (${usage.promptTokens}in/${usage.completionTokens}out) $${usage.cost.toFixed(6)}`,
    ]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
