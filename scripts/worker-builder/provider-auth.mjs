/**
 * Provider Authentication
 * 
 * Manages API keys and credentials for AI providers.
 * Stores credentials securely in ~/.nooterra/credentials/
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import http from 'http';
import { execSync } from 'child_process';

const CREDENTIALS_DIR = path.join(os.homedir(), '.nooterra', 'credentials');
const CONFIG_FILE = path.join(os.homedir(), '.nooterra', 'config.json');

/**
 * Supported providers
 */
// OpenAI Codex OAuth constants
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const CODEX_SCOPES = 'openid profile email offline_access api.connectors.read api.connectors.invoke';
const CODEX_REDIRECT_PORT = 1455;

export const PROVIDERS = {
  'chatgpt': {
    id: 'chatgpt',
    name: 'ChatGPT (subscription)',
    envVar: null,
    keyPrefix: null,
    authType: 'oauth',
    models: ['gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2-codex'],
    defaultModel: 'gpt-5.3-codex',
    apiBase: 'https://chatgpt.com/backend-api',
    originatorHeader: 'codex_cli_rs',
    docsUrl: 'https://chatgpt.com'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI (API key)',
    envVar: 'OPENAI_API_KEY',
    keyPrefix: 'sk-',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    testEndpoint: 'https://api.openai.com/v1/models',
    docsUrl: 'https://platform.openai.com/api-keys'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    defaultModel: 'claude-3-5-sonnet-20241022',
    testEndpoint: 'https://api.anthropic.com/v1/messages',
    docsUrl: 'https://console.anthropic.com/settings/keys'
  },
  google: {
    id: 'google',
    name: 'Google AI',
    envVar: 'GOOGLE_AI_API_KEY',
    keyPrefix: 'AI',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-pro'],
    defaultModel: 'gemini-1.5-flash',
    testEndpoint: 'https://generativelanguage.googleapis.com/v1/models',
    docsUrl: 'https://aistudio.google.com/app/apikey'
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    keyPrefix: 'sk-or-',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'meta-llama/llama-3.1-405b'],
    defaultModel: 'anthropic/claude-3.5-sonnet',
    testEndpoint: 'https://openrouter.ai/api/v1/models',
    docsUrl: 'https://openrouter.ai/keys'
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    envVar: 'GROQ_API_KEY',
    keyPrefix: 'gsk_',
    models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    defaultModel: 'llama-3.1-70b-versatile',
    testEndpoint: 'https://api.groq.com/openai/v1/models',
    docsUrl: 'https://console.groq.com/keys'
  },
  local: {
    id: 'local',
    name: 'Local (Ollama)',
    envVar: null,
    keyPrefix: null,
    models: ['llama3.1', 'mistral', 'codellama'],
    defaultModel: 'llama3.1',
    testEndpoint: 'http://localhost:11434/api/tags',
    docsUrl: 'https://ollama.ai'
  }
};

/**
 * Get machine-specific encryption key
 * Uses a combination of machine identifiers
 */
function getMachineKey() {
  const machineId = [
    os.hostname(),
    os.userInfo().username,
    os.platform(),
    os.arch()
  ].join(':');
  
  return crypto.createHash('sha256').update(machineId).digest();
}

/**
 * Encrypt a value
 */
function encrypt(text) {
  const key = getMachineKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a value
 */
function decrypt(text) {
  const key = getMachineKey();
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Ensure credentials directory exists
 */
function ensureDir() {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Get credential file path for a provider
 */
function getCredentialPath(providerId) {
  return path.join(CREDENTIALS_DIR, `${providerId}.enc`);
}

/**
 * Save API key for a provider
 */
export function saveApiKey(providerId, apiKey) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  ensureDir();
  
  const encrypted = encrypt(apiKey);
  const credPath = getCredentialPath(providerId);
  
  fs.writeFileSync(credPath, encrypted, { mode: 0o600 });
  
  return true;
}

/**
 * Load API key for a provider
 */
export function loadApiKey(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  // Check environment variable first
  if (provider.envVar && process.env[provider.envVar]) {
    return process.env[provider.envVar];
  }

  // Check saved credentials
  const credPath = getCredentialPath(providerId);
  if (fs.existsSync(credPath)) {
    try {
      const encrypted = fs.readFileSync(credPath, 'utf8');
      return decrypt(encrypted);
    } catch (err) {
      console.error(`Failed to decrypt credentials for ${providerId}:`, err.message);
      return null;
    }
  }

  return null;
}

/**
 * Delete API key for a provider
 */
export function deleteApiKey(providerId) {
  const credPath = getCredentialPath(providerId);
  if (fs.existsSync(credPath)) {
    fs.unlinkSync(credPath);
    return true;
  }
  return false;
}

/**
 * Check if provider is configured
 */
export function isProviderConfigured(providerId) {
  if (providerId === 'chatgpt') {
    return loadOAuthTokens('chatgpt') !== null;
  }
  return loadApiKey(providerId) !== null;
}

/**
 * Get all configured providers
 */
export function getConfiguredProviders() {
  return Object.keys(PROVIDERS).filter(id => isProviderConfigured(id));
}

/**
 * Test provider connection
 */
export async function testProvider(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    return { success: false, error: `Unknown provider: ${providerId}` };
  }

  const apiKey = loadApiKey(providerId);
  if (!apiKey && provider.id !== 'local') {
    return { success: false, error: 'API key not configured' };
  }

  try {
    const headers = {};
    
    if (providerId === 'openai') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (providerId === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (providerId === 'google') {
      // Google uses query param
    } else if (providerId === 'openrouter' || providerId === 'groq') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let url = provider.testEndpoint;
    if (providerId === 'google') {
      url += `?key=${apiKey}`;
    }

    const response = await fetch(url, { 
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      return { success: true, provider: provider.name };
    } else {
      const text = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 100)}` };
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Connection timeout' };
    }
    return { success: false, error: err.message };
  }
}

/**
 * Get default provider (first configured)
 */
export function getDefaultProvider() {
  const config = loadConfig();
  if (config.defaultProvider && isProviderConfigured(config.defaultProvider)) {
    return config.defaultProvider;
  }
  
  const configured = getConfiguredProviders();
  return configured.length > 0 ? configured[0] : null;
}

/**
 * Set default provider
 */
export function setDefaultProvider(providerId) {
  if (!PROVIDERS[providerId]) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  
  const config = loadConfig();
  config.defaultProvider = providerId;
  saveConfig(config);
}

/**
 * Load global config
 */
export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

/**
 * Save global config
 */
export function saveConfig(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Get provider info
 */
export function getProvider(providerId) {
  return PROVIDERS[providerId] || null;
}

/**
 * Get all providers
 */
export function getAllProviders() {
  return Object.values(PROVIDERS);
}

export function listProviders() {
  return getAllProviders();
}

/**
 * Validate API key format
 */
export function validateKeyFormat(providerId, apiKey) {
  const provider = PROVIDERS[providerId];
  if (!provider || !provider.keyPrefix) {
    return true; // Can't validate
  }
  return apiKey.startsWith(provider.keyPrefix);
}

/**
 * Validate an API key by making a lightweight test call to the provider.
 * Returns { valid: true, models: [...] } or { valid: false, error: "..." }
 */
export async function validateApiKey(providerId, apiKey) {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    return { valid: false, error: `Unknown provider: ${providerId}` };
  }

  try {
    let response;

    switch (providerId) {
      case 'openai': {
        response = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return { valid: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }
        const data = await response.json();
        const models = (data.data || []).map(m => m.id).slice(0, 20);
        return { valid: true, models };
      }

      case 'anthropic': {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }]
          }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          // 401 = bad key, other errors might still mean key is valid
          if (response.status === 401) {
            return { valid: false, error: `Authentication failed: ${text.slice(0, 200)}` };
          }
          // 400/overloaded can still mean key is valid
          if (response.status === 529 || response.status === 400) {
            return { valid: true, models: provider.models };
          }
          return { valid: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }
        return { valid: true, models: provider.models };
      }

      case 'groq': {
        response = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return { valid: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }
        const data = await response.json();
        const models = (data.data || []).map(m => m.id).slice(0, 20);
        return { valid: true, models };
      }

      case 'openrouter': {
        response = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return { valid: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }
        const data = await response.json();
        const models = (data.data || []).map(m => m.id).slice(0, 20);
        return { valid: true, models };
      }

      case 'google': {
        response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`, {
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          return { valid: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }
        const data = await response.json();
        const models = (data.models || []).map(m => m.name?.replace('models/', '') || m.name).slice(0, 20);
        return { valid: true, models };
      }

      case 'local': {
        response = await fetch('http://localhost:11434/api/tags', {
          signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) {
          return { valid: false, error: `Ollama returned HTTP ${response.status}` };
        }
        const data = await response.json();
        const models = (data.models || []).map(m => m.name);
        return { valid: true, models };
      }

      default:
        return { valid: false, error: `No validation implemented for provider: ${providerId}` };
    }
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return { valid: false, error: 'Connection timed out — is the service reachable?' };
    }
    return { valid: false, error: err.message };
  }
}

/**
 * Get provider status summary
 */
export function getProviderStatus() {
  const status = {};
  
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    const configured = isProviderConfigured(id);
    status[id] = {
      id,
      name: provider.name,
      configured,
      defaultModel: provider.defaultModel,
      models: provider.models
    };
  }
  
  return status;
}

export function hasCredentials(providerId) {
  return isProviderConfigured(providerId);
}

export function loadCredentials(providerId) {
  return loadApiKey(providerId);
}

/**
 * Interactive provider setup (returns questions for TUI)
 */
export function getSetupQuestions(providerId) {
  const provider = PROVIDERS[providerId];
  if (!provider) return [];

  if (providerId === 'local') {
    return [{
      type: 'confirm',
      question: 'Is Ollama running locally?',
      hint: 'Start with: ollama serve'
    }];
  }

  return [{
    type: 'password',
    question: `Enter your ${provider.name} API key:`,
    hint: `Get one at: ${provider.docsUrl}`,
    validate: (key) => {
      if (!key || key.trim() === '') {
        return 'API key is required';
      }
      if (!validateKeyFormat(providerId, key)) {
        return `Invalid key format. ${provider.name} keys start with "${provider.keyPrefix}"`;
      }
      return null;
    },
    asyncValidate: async (key) => {
      const result = await validateApiKey(providerId, key.trim());
      if (!result.valid) {
        return { error: `API key validation failed: ${result.error}. Please try again.` };
      }
      return { success: true, models: result.models, message: `Key valid! Available models: ${(result.models || []).slice(0, 5).join(', ')}${(result.models || []).length > 5 ? '...' : ''}` };
    }
  }];
}

// --- ChatGPT / Codex OAuth Flow ---

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

function buildAuthUrl(pkce, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CODEX_CLIENT_ID,
    redirect_uri: CODEX_REDIRECT_URI,
    scope: CODEX_SCOPES,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs'
  });
  return `${CODEX_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code, pkce) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CODEX_REDIRECT_URI,
    client_id: CODEX_CLIENT_ID,
    code_verifier: pkce.verifier
  });

  const response = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

function saveOAuthTokens(providerId, tokens) {
  ensureDir();
  const tokenData = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expires_at: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : null,
    token_type: tokens.token_type || 'Bearer',
    scope: tokens.scope || CODEX_SCOPES,
    saved_at: new Date().toISOString()
  };
  const credPath = path.join(CREDENTIALS_DIR, `${providerId}-oauth.json`);
  fs.writeFileSync(credPath, JSON.stringify(tokenData, null, 2), { mode: 0o600 });
  return tokenData;
}

export function loadOAuthTokens(providerId) {
  const credPath = path.join(CREDENTIALS_DIR, `${providerId}-oauth.json`);
  if (!fs.existsSync(credPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    if (data.expires_at && Date.now() > data.expires_at) {
      // Token expired — try refresh
      return { ...data, expired: true };
    }
    return data;
  } catch {
    return null;
  }
}

async function refreshOAuthToken(providerId) {
  const existing = loadOAuthTokens(providerId);
  if (!existing || !existing.refresh_token) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: existing.refresh_token,
    client_id: CODEX_CLIENT_ID
  });

  try {
    const response = await fetch(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!response.ok) return null;
    const tokens = await response.json();
    return saveOAuthTokens(providerId, tokens);
  } catch {
    return null;
  }
}

/**
 * Get a valid access token for an OAuth provider.
 * Automatically refreshes if expired.
 * Throws a descriptive error when token is expired and refresh fails.
 */
export async function getOAuthAccessToken(providerId) {
  let tokens = loadOAuthTokens(providerId);
  if (!tokens) return null;

  if (tokens.expired && tokens.refresh_token) {
    tokens = await refreshOAuthToken(providerId);
    if (!tokens) {
      throw new Error(`OAuth token expired. Run "nooterra" to re-authenticate with ${providerId === 'chatgpt' ? 'ChatGPT' : providerId}.`);
    }
  }

  if (tokens.expired) {
    throw new Error(`OAuth token expired. Run "nooterra" to re-authenticate with ${providerId === 'chatgpt' ? 'ChatGPT' : providerId}.`);
  }

  return tokens.access_token;
}

/**
 * Run the full ChatGPT OAuth login flow.
 * Opens browser, starts local callback server, exchanges code for tokens.
 * Returns the token data on success, null on failure.
 */
export function runChatGPTOAuthFlow() {
  return new Promise((resolve, reject) => {
    const pkce = generatePKCE();
    const state = generateState();
    const authUrl = buildAuthUrl(pkce, state);

    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    // Start local server to receive the callback
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://localhost:${CODEX_REDIRECT_PORT}`);

        if (url.pathname !== '/auth/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        const errorPage = (msg) => `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Nooterra - Error</title><style>:root{--bg:#07090d;--text:#f5f5f4;--dim:#a8a29e;--red:#ef4444}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,sans-serif;text-align:center}h1{color:var(--red);font-size:24px;margin:0 0 12px}p{color:var(--dim);font-size:15px;line-height:1.6;margin:0}.brand{margin-top:32px;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(168,162,158,0.4)}</style></head><body><main><h1>Authentication failed</h1><p>${msg}</p><p class="brand">nooterra</p></main></body></html>`;

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorPage('An error occurred. Close this tab and try again.'));
          server.close();
          settle(reject, new Error(`OAuth error: ${error}`));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorPage('State mismatch. Close this tab and try again.'));
          server.close();
          settle(reject, new Error('OAuth state mismatch'));
          return;
        }

        if (!code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(errorPage('No authorization code received. Close this tab and try again.'));
          server.close();
          settle(reject, new Error('No authorization code received'));
          return;
        }

        // Exchange code for tokens
        const tokens = await exchangeCodeForTokens(code, pkce);
        const saved = saveOAuthTokens('chatgpt', tokens);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connected to Nooterra</title>
  <style>
    :root { --gold: #d2b06f; --bg: #07090d; --text: #f5f5f4; --dim: #a8a29e; }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; text-align: center; }
    main { max-width: 480px; }
    .check { width: 64px; height: 64px; margin: 0 auto 24px; border-radius: 50%; background: rgba(210, 176, 111, 0.12); display: flex; align-items: center; justify-content: center; }
    .check svg { width: 32px; height: 32px; }
    h1 { margin: 0 0 12px; font-size: 24px; font-weight: 600; color: var(--gold); }
    p { margin: 0; font-size: 15px; line-height: 1.6; color: var(--dim); }
    .brand { margin-top: 32px; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(168, 162, 158, 0.4); }
  </style>
</head>
<body>
  <main>
    <div class="check"><svg fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="#d2b06f"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg></div>
    <h1>Connected to ChatGPT</h1>
    <p>Your ChatGPT Pro subscription is linked. Close this tab and return to your terminal.</p>
    <p class="brand">nooterra</p>
  </main>
</body>
</html>`);
        server.close();
        settle(resolve, saved);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>Error</h1><p>' + err.message + '</p></body></html>');
        server.close();
        settle(reject, err);
      }
    });

    server.listen(CODEX_REDIRECT_PORT, '127.0.0.1', () => {
      // Open browser
      const openCmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open';

      // execSync imported at top of file
      try {
        execSync(`${openCmd} "${authUrl}"`, { stdio: 'ignore' });
      } catch {
        // If browser open fails, print the URL for manual copy
        console.log('\nOpen this URL in your browser:\n');
        console.log(authUrl);
        console.log('');
      }
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      settle(reject, new Error('OAuth flow timed out (2 minutes). Try again.'));
    }, 120_000);
  });
}

// Override loadApiKey to also check OAuth tokens for chatgpt provider
const _originalLoadApiKey = loadApiKey;
export { _originalLoadApiKey };

/**
 * Load credentials for any provider — handles both API keys and OAuth tokens.
 */
export async function loadProviderCredential(providerId) {
  if (providerId === 'chatgpt') {
    return getOAuthAccessToken('chatgpt');
  }
  return loadApiKey(providerId);
}

export default {
  PROVIDERS,
  saveApiKey,
  loadApiKey,
  deleteApiKey,
  isProviderConfigured,
  getConfiguredProviders,
  testProvider,
  getDefaultProvider,
  setDefaultProvider,
  getProvider,
  getAllProviders,
  listProviders,
  getProviderStatus,
  getSetupQuestions,
  hasCredentials,
  loadCredentials,
  loadConfig,
  saveConfig,
  runChatGPTOAuthFlow,
  loadOAuthTokens,
  getOAuthAccessToken,
  loadProviderCredential,
  validateApiKey
};
