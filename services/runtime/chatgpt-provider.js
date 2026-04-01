/**
 * ChatGPT Responses API Provider
 *
 * Uses the Codex OAuth tokens from a ChatGPT Pro subscription
 * to generate team proposals at $0 marginal cost.
 *
 * Token storage priority:
 * 1. Postgres (chatgpt_tokens table) — persists across Railway restarts
 * 2. Environment vars (CHATGPT_REFRESH_TOKEN) — initial seed only
 *
 * On first deploy: set CHATGPT_REFRESH_TOKEN + CHATGPT_ACCOUNT_ID env vars.
 * The provider auto-refreshes and saves new tokens to Postgres.
 * After that, env vars don't matter — Postgres is the source of truth.
 */

import { encryptCredential, decryptCredential } from './crypto-utils.js';

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const DEFAULT_MODEL = 'gpt-5.4-mini';

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'chatgpt-provider', msg });
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

// ---------------------------------------------------------------------------
// Token management — Postgres-backed with env var bootstrap
// ---------------------------------------------------------------------------

let cachedTokens = null;
let dbPool = null;

/**
 * Initialize with a Postgres pool. Call once at startup.
 */
export function initChatGPTProvider(pool) {
  dbPool = pool;
  ensureTokenTable().catch(err => {
    log('error', `Failed to create chatgpt_tokens table: ${err.message}`);
  });
}

async function ensureTokenTable() {
  if (!dbPool) return;
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS chatgpt_tokens (
      id TEXT PRIMARY KEY DEFAULT 'default',
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      account_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function loadTokensFromDB() {
  if (!dbPool) return null;
  try {
    const { rows } = await dbPool.query(
      `SELECT access_token, refresh_token, account_id FROM chatgpt_tokens WHERE id = 'default'`
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      accessToken: decryptCredential(row.access_token),
      refreshToken: decryptCredential(row.refresh_token),
      accountId: row.account_id || null,
    };
  } catch {
    return null;
  }
}

async function saveTokensToDB(tokens) {
  if (!dbPool) return;
  try {
    const encAccess = encryptCredential(tokens.accessToken);
    const encRefresh = encryptCredential(tokens.refreshToken);
    await dbPool.query(`
      INSERT INTO chatgpt_tokens (id, access_token, refresh_token, account_id, updated_at)
      VALUES ('default', $1, $2, $3, now())
      ON CONFLICT (id) DO UPDATE SET
        access_token = $1,
        refresh_token = $2,
        account_id = COALESCE($3, chatgpt_tokens.account_id),
        updated_at = now()
    `, [encAccess, encRefresh, tokens.accountId]);
  } catch (err) {
    log('error', `Failed to save tokens to DB: ${err.message}`);
  }
}

function loadTokensFromEnv() {
  const refreshToken = process.env.CHATGPT_REFRESH_TOKEN;
  if (!refreshToken) return null;
  return {
    accessToken: process.env.CHATGPT_ACCESS_TOKEN || 'needs-refresh',
    refreshToken,
    accountId: process.env.CHATGPT_ACCOUNT_ID || null,
  };
}

async function getTokens() {
  if (cachedTokens) return cachedTokens;

  // 1. Try Postgres (source of truth — has latest refreshed tokens)
  cachedTokens = await loadTokensFromDB();
  if (cachedTokens) {
    log('info', 'Loaded ChatGPT tokens from database');
    return cachedTokens;
  }

  // 2. Bootstrap from env vars (first deploy only)
  cachedTokens = loadTokensFromEnv();
  if (cachedTokens) {
    log('info', 'Loaded ChatGPT tokens from env vars (first deploy bootstrap)');
    // Immediately persist to DB so we don't need env vars again
    await saveTokensToDB(cachedTokens);
    return cachedTokens;
  }

  return null;
}

async function refreshAccessToken() {
  const tokens = await getTokens();
  if (!tokens?.refreshToken) {
    log('error', 'No refresh token available');
    return null;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: CODEX_CLIENT_ID,
    });

    const res = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log('error', `Token refresh failed: HTTP ${res.status} ${text.slice(0, 100)}`);
      return null;
    }

    const data = await res.json();
    cachedTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      accountId: tokens.accountId,
    };

    // Persist to Postgres — survives restarts, rotated refresh tokens stay current
    await saveTokensToDB(cachedTokens);

    log('info', 'Refreshed ChatGPT access token and saved to database');
    return cachedTokens;
  } catch (err) {
    log('error', `Token refresh error: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Responses API call
// ---------------------------------------------------------------------------

function convertToResponsesInput(messages) {
  const input = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    input.push({ role: msg.role, content: msg.content });
  }
  return input;
}

async function* callResponsesAPI(systemPrompt, messages, model) {
  let tokens = await getTokens();
  if (!tokens) {
    throw new Error('ChatGPT not configured. Set CHATGPT_REFRESH_TOKEN env var and redeploy.');
  }

  const input = convertToResponsesInput(messages);
  const reqBody = {
    model: model || DEFAULT_MODEL,
    instructions: systemPrompt,
    input,
    stream: true,
    store: false,
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokens.accessToken}`,
    'OpenAI-Beta': 'responses=experimental',
    'originator': 'codex_cli_rs',
  };
  if (tokens.accountId) {
    headers['ChatGPT-Account-ID'] = tokens.accountId;
  }

  let res = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody),
  });

  // If 401, refresh token and retry once
  if (res.status === 401) {
    log('info', 'Access token expired, refreshing...');
    tokens = await refreshAccessToken();
    if (!tokens) throw new Error('Failed to refresh ChatGPT token. Re-authenticate via Codex CLI.');

    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
    res = await fetch(CODEX_RESPONSES_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ChatGPT API error ${res.status}: ${text.slice(0, 200)}`);
  }

  // Parse streaming response
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalInput = 0;
  let totalOutput = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        if (!data) continue;

        try {
          const event = JSON.parse(data);

          if (event.type === 'response.output_text.delta') {
            yield { type: 'token', content: event.delta || '' };
          } else if (event.type === 'response.completed') {
            const usage = event.response?.usage || {};
            totalInput = usage.input_tokens || 0;
            totalOutput = usage.output_tokens || 0;
          }
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield {
    type: 'done',
    usage: {
      promptTokens: totalInput,
      completionTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      cost: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function isChatGPTAvailable() {
  return (await getTokens()) !== null;
}

export async function* chatGPTCompletion({ systemPrompt, messages, model }) {
  yield* callResponsesAPI(systemPrompt, messages, model);
}

export default { chatGPTCompletion, isChatGPTAvailable, initChatGPTProvider };
