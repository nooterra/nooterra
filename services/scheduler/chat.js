/**
 * Chat Endpoint
 *
 * Proxies conversations through OpenRouter with streaming SSE responses.
 * Mounted in the scheduler's HTTP server as POST /v1/chat.
 * Tracks token usage and deducts from tenant_credits.
 */

import { chatCompletion, estimateCost } from './openrouter.js';

const NOOTERRA_SYSTEM_PROMPT = `You are Nooterra, an AI assistant that helps users create and manage AI workers.
You can have general conversations, brainstorm ideas, and help users think through
what workers they need. When a user describes work they need done, help them define
it as a worker with clear canDo/askFirst/neverDo rules.

You are conversational, helpful, and concise. You can discuss anything but always
keep in mind that your primary purpose is helping users deploy AI workers that run
24/7 with guardrails.

When a user has described enough about a worker they want, output a structured worker definition block like this:

[WORKER_DEFINITION]
name: Worker Name
canDo: action1, action2
askFirst: action1, action2
neverDo: action1, action2
schedule: every hour
model: google/gemini-3-flash
[/WORKER_DEFINITION]

Only output this block when the user has given you enough detail about what the worker should do.
Do not output it prematurely. Continue the conversation naturally until you have clarity on the worker's purpose,
permissions, and schedule.`;

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
