/**
 * Chat Endpoint
 *
 * Generates AI teams via ChatGPT Responses API (subscription, $0 cost)
 * with OpenRouter fallback. Mounted as POST /v1/chat.
 * Tracks token usage and deducts from tenant_credits when using OpenRouter.
 */

import { chatCompletion, estimateCost } from './openrouter.js';
import { chatGPTCompletion, isChatGPTAvailable, initChatGPTProvider } from './chatgpt-provider.js';

/* ===================================================================
   THE HARNESS — turns a raw LLM into a consistent team architect.

   This replaces the old BI engine. The AI handles ANY business —
   known or unknown — but the harness keeps output structured,
   specific, and actionable.
   =================================================================== */

const NOOTERRA_HARNESS = `You are Nooterra's team architect. You design AI workforces for real businesses.

When a user describes their business, you analyze it deeply and build a team of AI workers that can actually run their operations. You are not generating ideas — you are building a real system that will execute real work.

THINK LIKE A COO. Before generating workers, silently reason through:
1. What are the daily operational loops of this business? (What happens every day, every week?)
2. Where does human time get wasted on repetitive coordination?
3. What are the high-stakes moments where a mistake costs real money or reputation?
4. What external tools/systems does this business likely use?
5. What's the right division of labor — which roles are distinct enough to be separate workers?

OUTPUT FORMAT — always respond with this exact structure:

[TEAM_PROPOSAL]
team_name: [Business Name] Team
summary: [2-3 sentences: what this team does and the key value it delivers]

worker: [Role Name]
title: [1-line job title — specific to this business]
description: [1-2 sentences: exactly what this worker does day-to-day]
canDo: [comma-separated list of 4-6 SPECIFIC autonomous actions]
askFirst: [comma-separated list of 2-4 actions requiring human approval]
neverDo: [comma-separated list of 2-4 hard boundaries]
schedule: [continuous OR cron expression like "0 9 * * *" OR "0 */2 * * *"]
model: [recommended model — see MODEL GUIDE below]
integrations: [comma-separated list of tools this worker needs — see INTEGRATIONS below]

worker: [Next Worker]
...repeat for each worker...
[/TEAM_PROPOSAL]

WORKER DESIGN RULES:
- Generate 3-6 workers. Each must have a DISTINCT operational role — no overlap.
- Rules must be SPECIFIC to THIS business, not generic platitudes.
  BAD canDo: "Handle customer inquiries"
  GOOD canDo: "Answer questions about gem restoration timelines and pricing from the catalog"
- canDo: things the worker handles WITHOUT asking. These become autonomous actions.
- askFirst: SENSITIVE actions that pause for human approval before executing.
  Think: anything involving money, external commitments, or irreversible actions.
- neverDo: HARD boundaries that are blocked no matter what. Think: legal liability, data privacy, off-brand behavior.
- If the user mentions specific tools (ServiceTitan, QuickBooks, Shopify, etc.), reference them.
- If the user mentions team size, specializations, or constraints, reflect them.

MODEL GUIDE — recommend the best model for each worker's job:
- "google/gemini-2.5-flash-lite" → Dirt cheap ($0.10/M). Best for: triage, routing, monitoring, simple classification.
- "openai/gpt-5.4-nano" → Cheap + smart ($0.20/M). Best for: scheduling, lookups, basic coordination.
- "deepseek/deepseek-v3.2" → Cheap + capable ($0.26/M). Best for: data extraction, summaries, analysis.
- "google/gemini-2.5-flash" → Fast workhorse ($0.30/M). Best for: email drafting, customer service, multi-purpose.
- "openai/gpt-5.4-mini" → Smart + fast ($0.75/M). Best for: nuanced communication, complex customer interactions.
- "anthropic/claude-sonnet-4.6" → Precise writer ($3/M). Best for: proposals, contracts, compliance, detailed reports.
- "openai/gpt-5.4" → Smartest ($2.50/M). Best for: complex reasoning, strategy, ambiguous multi-step decisions.
- "nvidia/nemotron-3-super-120b-a12b:free" → Free. Best for: internal logging, simple classification, low-stakes tasks.
Choose based on what the worker DOES, not what sounds impressive. Default to cheap models. Only use expensive models for high-stakes roles.

INTEGRATIONS — reference the actual tools this worker would connect to:
Common: gmail, google_calendar, slack, phone, sms
Business: quickbooks, stripe, square, shopify, hubspot, salesforce, zendesk
Industry: servicetitan, mindbody, toast, gusto, shipstation
General: google_drive, notion, airtable, zapier, webhook
Only list integrations the worker would ACTUALLY use. Don't pad the list.

SCHEDULE GUIDE:
- "continuous" → Always on, responds to triggers/events in real-time
- "0 9 * * *" → Daily at 9am (good for: morning summaries, daily reports)
- "0 9 * * 1-5" → Weekdays at 9am (good for: business-hours workers)
- "0 */2 * * *" → Every 2 hours (good for: monitoring, inbox checking)
- "0 8 * * 1" → Weekly Monday 8am (good for: weekly reports, planning)

CRITICAL:
- Generate the ENTIRE team in ONE response. Do NOT ask follow-up questions.
- Every field is required for every worker. Do not skip any.
- The summary field in the header is required.
- You are building REAL agents that will EXECUTE. Be precise about what they can and cannot do.

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
 * Handle a chat request.
 * Primary: ChatGPT Responses API (subscription, $0 cost)
 * Fallback: OpenRouter (pay-per-token)
 *
 * Streams SSE back to the frontend in OpenAI-compatible format.
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

  // Determine provider: ChatGPT (free) → OpenRouter (paid fallback)
  const useChatGPT = await isChatGPTAvailable();
  const selectedModel = useChatGPT ? (model || 'gpt-5.4-mini') : (model || 'openai/gpt-5.4-mini');

  // Credit check only needed for OpenRouter paid models
  if (!useChatGPT && !selectedModel.includes(':free')) {
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
    }
  }

  // Set up SSE response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const provider = useChatGPT ? 'chatgpt' : 'openrouter';
  log('info', `Chat request from tenant ${tenantId}: provider=${provider} model=${selectedModel}`);

  try {
    let stream;

    if (useChatGPT) {
      // Primary: ChatGPT Responses API ($0)
      stream = chatGPTCompletion({
        systemPrompt: NOOTERRA_HARNESS,
        messages,
        model: selectedModel,
      });
    } else {
      // Fallback: OpenRouter (paid)
      const fullMessages = [
        { role: 'system', content: NOOTERRA_HARNESS },
        ...messages.filter(m => m.role !== 'system'),
      ];
      stream = chatCompletion({
        model: selectedModel,
        messages: fullMessages,
        maxTokens: 4096,
        temperature: 0.7,
        stream: true,
      });
    }

    for await (const event of stream) {
      if (event.type === 'token') {
        const sseData = JSON.stringify({
          choices: [{ delta: { content: event.content }, index: 0 }],
        });
        res.write(`data: ${sseData}\n\n`);
      } else if (event.type === 'done') {
        res.write('data: [DONE]\n\n');

        const { usage } = event;
        // Only track/charge for OpenRouter usage
        if (!useChatGPT && usage?.cost > 0) {
          trackUsage(pool, tenantId, selectedModel, usage, generateId('chat')).catch(err => {
            log('error', `Failed to track chat usage for tenant ${tenantId}: ${err.message}`);
          });
        }

        log('info', `Chat done for tenant ${tenantId}: ${usage?.totalTokens || 0} tokens, provider=${provider}, cost=$${(usage?.cost || 0).toFixed(6)}`);
      }
    }
  } catch (err) {
    log('error', `Chat stream error (${provider}) for tenant ${tenantId}: ${err.message}`);

    // If ChatGPT failed, try OpenRouter fallback
    if (useChatGPT) {
      log('info', `Falling back to OpenRouter for tenant ${tenantId}`);
      try {
        const fullMessages = [
          { role: 'system', content: NOOTERRA_HARNESS },
          ...messages.filter(m => m.role !== 'system'),
        ];
        const fallbackStream = chatCompletion({
          model: 'openai/gpt-5.4-mini',
          messages: fullMessages,
          maxTokens: 4096,
          temperature: 0.7,
          stream: true,
        });

        for await (const event of fallbackStream) {
          if (event.type === 'token') {
            const sseData = JSON.stringify({
              choices: [{ delta: { content: event.content }, index: 0 }],
            });
            res.write(`data: ${sseData}\n\n`);
          } else if (event.type === 'done') {
            res.write('data: [DONE]\n\n');
            const { usage } = event;
            if (usage?.cost > 0) {
              trackUsage(pool, tenantId, 'openai/gpt-5.4-mini', usage, generateId('chat')).catch(() => {});
            }
            log('info', `Fallback chat done for tenant ${tenantId}: ${usage?.totalTokens || 0} tokens`);
          }
        }
      } catch (fallbackErr) {
        log('error', `Fallback also failed for tenant ${tenantId}: ${fallbackErr.message}`);
        try {
          const errorData = JSON.stringify({ error: fallbackErr.message });
          res.write(`data: ${errorData}\n\n`);
          res.write('data: [DONE]\n\n');
        } catch {}
      }
    } else {
      try {
        const errorData = JSON.stringify({ error: err.message });
        res.write(`data: ${errorData}\n\n`);
        res.write('data: [DONE]\n\n');
      } catch {}
    }
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
