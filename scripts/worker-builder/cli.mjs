#!/usr/bin/env node

/**
 * Nooterra TUI
 *
 * The complete terminal experience. Handles:
 * - First-run onboarding (provider auth)
 * - Worker creation via conversation
 * - Worker management, status, receipts
 * - Natural language + /commands
 */

import { createInterface } from 'readline';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { createConversation, processInput, instantCreate, WORKER_TEMPLATES, CONVERSATION_STATES } from './worker-builder-core.mjs';
import { createWorker, listWorkers, loadWorker, findWorkerByName, WORKER_STATUS } from './worker-persistence.mjs';
import {
  PROVIDERS, isProviderConfigured, getDefaultProvider, setDefaultProvider,
  saveApiKey, loadApiKey, getConfiguredProviders, loadOAuthTokens,
  runChatGPTOAuthFlow, loadProviderCredential
} from './provider-auth.mjs';
import { buildCharterFromContext, generateCharterSummary } from './charter-compiler.mjs';
import { TRIGGER_TYPES } from './trigger-engine.mjs';

// Read version from package.json to keep it consistent
let VERSION = '0.4.0';
try {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  VERSION = pkg.version || VERSION;
} catch {}
const NOOTERRA_DIR = path.join(os.homedir(), '.nooterra');
const RUNS_DIR = path.join(NOOTERRA_DIR, 'runs');

// ── Colors ──────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gold: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
  bgGold: '\x1b[43m\x1b[30m',
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function clearScreen() { process.stdout.write('\x1b[2J\x1b[H'); }

function hr() { return c.gray + '─'.repeat(Math.min(process.stdout.columns || 72, 72)) + c.reset; }

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function printBanner() {
  console.log(`${c.gold}
 ███╗   ██╗ ██████╗  ██████╗ ████████╗███████╗██████╗ ██████╗  █████╗
 ████╗  ██║██╔═══██╗██╔═══██╗╚══██╔══╝██╔════╝██╔══██╗██╔══██╗██╔══██╗
 ██╔██╗ ██║██║   ██║██║   ██║   ██║   █████╗  ██████╔╝██████╔╝███████║
 ██║╚██╗██║██║   ██║██║   ██║   ██║   ██╔══╝  ██╔══██╗██╔══██╗██╔══██║
 ██║ ╚████║╚██████╔╝╚██████╔╝   ██║   ███████╗██║  ██║██║  ██║██║  ██║
 ╚═╝  ╚═══╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
${c.reset}
${c.dim}  v${VERSION} · AI workers you can actually trust${c.reset}
`);
}

function statusBar() {
  const provider = getDefaultProvider();
  const providerName = provider ? PROVIDERS[provider]?.name || provider : 'not connected';
  const workers = listWorkers();
  const running = workers.filter(w => w.status === WORKER_STATUS.RUNNING).length;
  const receipts = countReceipts();
  const workerText = workers.length === 0 ? 'no workers' : `${workers.length} worker${workers.length > 1 ? 's' : ''}${running > 0 ? ` (${running} running)` : ''}`;
  const parts = [
    `${c.gold}⬡${c.reset} ${providerName}`,
    `${c.dim}·${c.reset} ${workerText}`,
    `${c.dim}·${c.reset} ${receipts} receipt${receipts !== 1 ? 's' : ''}`
  ];
  return `\n  ${parts.join('  ')}\n`;
}

function countReceipts() {
  try { return fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).length; } catch { return 0; }
}

// ── Onboarding ──────────────────────────────────────────────────────────────
async function runOnboarding(rl) {
  console.log(`\n  ${c.bold}Welcome to Nooterra.${c.reset} Let's connect your AI.\n`);
  console.log(hr());
  console.log(`
  How should your workers think?

    ${c.gold}1${c.reset}  ChatGPT ${c.dim}(use your subscription — recommended)${c.reset}
    ${c.gold}2${c.reset}  OpenAI API key
    ${c.gold}3${c.reset}  Anthropic API key
    ${c.gold}4${c.reset}  OpenRouter ${c.dim}(200+ models)${c.reset}
    ${c.gold}5${c.reset}  Groq ${c.dim}(fast, free tier)${c.reset}
    ${c.gold}6${c.reset}  Local ${c.dim}(Ollama — free, runs on your machine)${c.reset}
`);

  const choice = await ask(rl, `  ${c.gold}>${c.reset} `);
  const num = parseInt(choice.trim(), 10);

  const providerMap = { 1: 'chatgpt', 2: 'openai', 3: 'anthropic', 4: 'openrouter', 5: 'groq', 6: 'local' };
  const providerId = providerMap[num] || providerMap[1];
  const provider = PROVIDERS[providerId];

  console.log('');

  if (providerId === 'chatgpt') {
    console.log(`  ${c.dim}Opening browser to connect your ChatGPT account...${c.reset}\n`);
    try {
      await runChatGPTOAuthFlow();
      setDefaultProvider('chatgpt');
      console.log(`\n  ${c.green}✓${c.reset} Connected to ${c.bold}ChatGPT Pro${c.reset} (${PROVIDERS.chatgpt.defaultModel})\n`);
    } catch (err) {
      console.log(`  ${c.red}✗${c.reset} OAuth failed: ${err.message}`);
      console.log(`  ${c.dim}Try again with /auth${c.reset}\n`);
      return false;
    }
  } else if (providerId === 'local') {
    setDefaultProvider('local');
    console.log(`  ${c.green}✓${c.reset} Using ${c.bold}Ollama${c.reset} (${provider.defaultModel})`);
    console.log(`  ${c.dim}Make sure Ollama is running: ollama serve${c.reset}\n`);
  } else {
    const key = await ask(rl, `  Paste your ${provider.name} API key: `);
    if (!key.trim()) {
      console.log(`  ${c.red}✗${c.reset} No key provided. Try again with /auth\n`);
      return false;
    }
    saveApiKey(providerId, key.trim());
    setDefaultProvider(providerId);
    console.log(`\n  ${c.green}✓${c.reset} Connected to ${c.bold}${provider.name}${c.reset} (${provider.defaultModel})\n`);
  }

  return true;
}

// ── Worker Creation Flow ────────────────────────────────────────────────────
async function createWorkerFlow(rl, initialInput) {
  const conversation = createConversation();
  const result = processInput(conversation, initialInput);

  console.log(`\n  ${c.cyan}Nooterra:${c.reset} ${result.message}\n`);

  while (conversation.state !== CONVERSATION_STATES.COMPLETE) {
    const answer = await ask(rl, `  ${c.gold}>${c.reset} `);
    if (!answer.trim()) continue;
    if (answer.trim() === '/cancel') {
      console.log(`\n  ${c.dim}Cancelled.${c.reset}\n`);
      return null;
    }

    const next = processInput(conversation, answer);
    console.log(`\n  ${c.cyan}Nooterra:${c.reset} ${next.message}\n`);

    if (conversation.state === CONVERSATION_STATES.COMPLETE || next.deployed) {
      const charter = buildCharterFromContext(conversation.context);
      const provider = getDefaultProvider() || 'chatgpt';
      const providerDef = PROVIDERS[provider] || PROVIDERS.openai;

      const worker = createWorker(charter, {
        provider,
        model: providerDef.defaultModel,
        triggers: conversation.context.schedule ? [{
          type: TRIGGER_TYPES.SCHEDULE,
          config: { schedule: conversation.context.schedule }
        }] : []
      });

      console.log(hr());
      console.log(`\n  ${c.green}✓${c.reset} ${c.bold}Worker created: ${worker.charter.name}${c.reset}\n`);
      printCharter(worker.charter);
      console.log(`\n  ${c.dim}Run it with /run ${worker.charter.name}${c.reset}\n`);
      return worker;
    }
  }
  return null;
}

function printCharter(charter) {
  const w = 56;
  const line = (s) => `  ${c.gray}│${c.reset} ${s.padEnd(w)}${c.gray}│${c.reset}`;
  console.log(`  ${c.gray}╭${'─'.repeat(w + 2)}╮${c.reset}`);
  console.log(line(`${c.bold}${charter.name || 'Worker'}${c.reset}`));
  console.log(line(''));
  if (charter.purpose) console.log(line(`${c.dim}${charter.purpose.slice(0, w)}${c.reset}`));
  console.log(line(''));
  if (charter.canDo?.length) {
    console.log(line(`${c.green}Can Do:${c.reset}`));
    for (const r of charter.canDo.slice(0, 4)) console.log(line(`  • ${r.slice(0, w - 4)}`));
  }
  if (charter.askFirst?.length) {
    console.log(line(`${c.gold}Ask First:${c.reset}`));
    for (const r of charter.askFirst.slice(0, 3)) console.log(line(`  • ${r.slice(0, w - 4)}`));
  }
  if (charter.neverDo?.length) {
    console.log(line(`${c.red}Never Do:${c.reset}`));
    for (const r of charter.neverDo.slice(0, 3)) console.log(line(`  • ${r.slice(0, w - 4)}`));
  }
  console.log(`  ${c.gray}╰${'─'.repeat(w + 2)}╯${c.reset}`);
}

// ── Commands ────────────────────────────────────────────────────────────────
async function handleCommand(cmd, args, rl) {
  switch (cmd) {
    case '/help': return showHelp();
    case '/new': return createWorkerFlow(rl, args || 'I want to create a new worker');
    case '/workers': return showWorkers();
    case '/status': return showStatus();
    case '/receipts': return showReceipts();
    case '/auth': return runOnboarding(rl);
    case '/run': return runWorker(args);
    case '/stop': return stopWorker(args);
    case '/templates': return showTemplates(rl);
    case '/teach': return teachWorker(args, rl);
    case '/dashboard': case '/dash': return showDashboard();
    case '/logs': return showLogs(args);
    case '/schedule': return showScheduleHelp(args);
    case '/approvals': return showApprovals();
    case '/cost': return showCost();
    case '/health': return showHealth();
    case '/delegate': return showDelegateHelp(args);
    case '/quit': case '/exit': case '/q':
      console.log(`\n  ${c.dim}Goodbye.${c.reset}\n`);
      process.exit(0);
    default:
      console.log(`\n  ${c.dim}Unknown command. Type /help for options.${c.reset}\n`);
  }
}

function showHelp() {
  console.log(`
  ${c.bold}Commands${c.reset}

  ${c.gold}Workers${c.reset}
  ${c.gold}/new${c.reset} [description]     Create a new worker
  ${c.gold}/workers${c.reset}               List all workers
  ${c.gold}/run${c.reset} <name>            Run a worker (live progress)
  ${c.gold}/teach${c.reset} <name> <info>   Give a worker company knowledge
  ${c.gold}/templates${c.reset}             Quick start templates
  ${c.gold}/stop${c.reset} <name>           Stop a worker
  ${c.gold}/delegate${c.reset}              Delegate between workers
  ${c.gold}/schedule${c.reset}              Schedule recurring runs

  ${c.gold}Monitoring${c.reset}
  ${c.gold}/dashboard${c.reset}             Real-time system dashboard
  ${c.gold}/status${c.reset}                Quick status overview
  ${c.gold}/logs${c.reset} <name>           Execution logs for a worker
  ${c.gold}/receipts${c.reset}              Recent execution receipts
  ${c.gold}/approvals${c.reset}             Pending approval queue
  ${c.gold}/cost${c.reset}                  Provider cost tracking
  ${c.gold}/health${c.reset}                Provider health & circuit breakers

  ${c.gold}Setup${c.reset}
  ${c.gold}/auth${c.reset}                  Change AI provider
  ${c.gold}/help${c.reset}                  Show this help
  ${c.gold}/quit${c.reset}                  Exit

  ${c.dim}Or just describe what you want — "I need a worker that monitors..."${c.reset}
`);
}

function showWorkers() {
  const workers = listWorkers();
  if (workers.length === 0) {
    console.log(`\n  ${c.dim}No workers yet. Describe what you need or type /new.${c.reset}\n`);
    return;
  }

  console.log(`\n  ${c.bold}Workers${c.reset}\n`);
  for (const w of workers) {
    const status = w.status === WORKER_STATUS.RUNNING
      ? `${c.green}● running${c.reset}`
      : w.status === WORKER_STATUS.PAUSED
        ? `${c.gold}⏸ paused${c.reset}`
        : w.status === WORKER_STATUS.ERROR
          ? `${c.red}✗ error${c.reset}`
          : `${c.dim}○ ready${c.reset}`;

    const name = w.charter?.name || w.id;
    const provider = w.provider ? `${c.dim}${PROVIDERS[w.provider]?.name || w.provider}${c.reset}` : '';
    const runs = w.stats?.totalRuns || 0;
    console.log(`    ${status}  ${c.white}${name}${c.reset}  ${provider}  ${c.dim}${runs} run${runs !== 1 ? 's' : ''}${c.reset}`);
  }
  console.log('');
}

function showStatus() {
  const provider = getDefaultProvider();
  const providerDef = provider ? PROVIDERS[provider] : null;
  const workers = listWorkers();
  const running = workers.filter(w => w.status === WORKER_STATUS.RUNNING).length;
  const receipts = countReceipts();

  console.log(`
  ${c.bold}Nooterra${c.reset} v${VERSION}

    Provider     ${providerDef ? `${c.green}●${c.reset} ${providerDef.name} (${providerDef.defaultModel})` : `${c.red}●${c.reset} not connected`}
    Workers      ${workers.length} total${running > 0 ? `, ${running} running` : ''}
    Receipts     ${receipts}
    Config       ~/.nooterra/
`);
}

function showReceipts() {
  try {
    const files = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 10);
    if (files.length === 0) {
      console.log(`\n  ${c.dim}No receipts yet. Run a worker to generate one.${c.reset}\n`);
      return;
    }

    console.log(`\n  ${c.bold}Recent Receipts${c.reset}\n`);
    for (const file of files) {
      try {
        const receipt = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, file), 'utf8'));
        const name = receipt.workerName || receipt.worker || file;
        const status = receipt.success || receipt.status === 'completed'
          ? `${c.green}✓${c.reset}`
          : `${c.red}✗${c.reset}`;
        const time = receipt.completedAt || receipt.timestamp || '';
        const short = time ? new Date(time).toLocaleString() : '';
        console.log(`    ${status}  ${c.white}${name}${c.reset}  ${c.dim}${short}${c.reset}`);
      } catch {
        console.log(`    ${c.dim}${file}${c.reset}`);
      }
    }
    console.log('');
  } catch {
    console.log(`\n  ${c.dim}No receipts yet.${c.reset}\n`);
  }
}

async function runWorker(nameOrId) {
  if (!nameOrId?.trim()) {
    console.log(`\n  ${c.dim}Usage: /run <worker name>${c.reset}\n`);
    return;
  }

  const workers = listWorkers();
  const match = workers.find(w =>
    (w.charter?.name || '').toLowerCase().includes(nameOrId.trim().toLowerCase()) ||
    w.id === nameOrId.trim()
  );

  if (!match) {
    console.log(`\n  ${c.red}✗${c.reset} Worker "${nameOrId.trim()}" not found. Type /workers to see all.\n`);
    return;
  }

  const provider = match.provider || getDefaultProvider();
  if (!provider) {
    console.log(`\n  ${c.red}✗${c.reset} No AI provider configured. Run /auth first.\n`);
    return;
  }

  console.log(`\n  ${c.bold}Running ${match.charter.name}...${c.reset}\n`);

  try {
    const { runWorkerExecution } = await import('./worker-daemon.mjs');
    const { getConnectionManager } = await import('./mcp-integration.mjs');

    let credential;
    try {
      credential = await loadProviderCredential(provider);
    } catch (authErr) {
      console.log(`  ${c.red}✗${c.reset} ${authErr.message}\n`);
      return;
    }
    if (!credential) {
      console.log(`  ${c.red}✗${c.reset} No credentials for ${provider}. Run /auth.\n`);
      return;
    }

    const mcpManager = getConnectionManager();
    const notificationBus = {
      notify: async (event, data) => {
        if (event === 'approval_needed') {
          console.log(`  ${c.gold}⚡ Approval needed:${c.reset} ${data.action || 'action requires approval'}`);
        }
      }
    };

    // Live activity feed — show users what's happening in real time
    const runStart = Date.now();
    const activityFeed = {
      start: (d) => {},
      thinking: (d) => {
        const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
        console.log(`  ${c.dim}${elapsed}s${c.reset}  ${c.dim}Thinking... (round ${(d?.round || 0) + 1})${c.reset}`);
      },
      toolCall: (d) => {
        const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
        const argsPreview = d?.args ? JSON.stringify(d.args).slice(0, 60) : '';
        console.log(`  ${c.dim}${elapsed}s${c.reset}  ${c.gold}🔧 ${d?.name}${c.reset}${argsPreview ? c.dim + '(' + argsPreview + ')' + c.reset : ''}`);
      },
      toolResult: (d) => {
        const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
        const dur = d?.durationMs ? `${d.durationMs}ms` : '';
        const preview = d?.preview ? d.preview.slice(0, 60).replace(/\n/g, ' ') : '';
        console.log(`  ${c.dim}${elapsed}s${c.reset}  ${c.green}✓ ${d?.name}${c.reset} ${c.dim}→ ${d?.chars || 0} chars ${dur}${c.reset}`);
      },
      charterCheck: (d) => {
        if (d?.verdict === 'neverDo') {
          console.log(`  ${c.dim}     ${c.reset}  ${c.red}🛡️ BLOCKED: ${d.rule}${c.reset}`);
        } else if (d?.verdict === 'askFirst') {
          console.log(`  ${c.dim}     ${c.reset}  ${c.gold}🛡️ Needs approval: ${d.rule}${c.reset}`);
        }
      },
      memorySave: (d) => {
        const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
        console.log(`  ${c.dim}${elapsed}s${c.reset}  ${c.cyan}💾 Memory saved: ${d?.key}${c.reset}`);
      },
      response: (d) => {},  // Will show full response at the end
      complete: (d) => {
        const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
        const ok = d?.success !== false;
        console.log(`  ${c.dim}${elapsed}s${c.reset}  ${ok ? c.green + '✅' : c.red + '❌'}${c.reset} ${ok ? 'Complete' : 'Failed'} — ${d?.rounds || 0} round${d?.rounds !== 1 ? 's' : ''}, ${d?.toolCallCount || 0} tool calls`);
      },
    };

    const result = await runWorkerExecution(match, mcpManager, notificationBus, credential, { activityFeed });

    if (result.response) {
      console.log(hr());
      console.log(`\n  ${c.bold}Output:${c.reset}\n`);
      // Indent and wrap the response
      const lines = result.response.split('\n');
      for (const line of lines) {
        console.log(`  ${line}`);
      }
      console.log('');
    }

    console.log(hr());
    console.log(`  ${c.green}✓${c.reset} ${match.charter.name} completed in ${result.duration}ms`);
    console.log(`  ${c.dim}Receipt: ${result.receipt?.taskId}${c.reset}\n`);
  } catch (err) {
    console.log(`  ${c.red}✗${c.reset} Execution failed: ${err.message}\n`);
  }
}

function stopWorker(nameOrId) {
  if (!nameOrId?.trim()) {
    console.log(`\n  ${c.dim}Usage: /stop <worker name>${c.reset}\n`);
    return;
  }
  console.log(`\n  ${c.dim}Worker stopping is not yet implemented for local workers.${c.reset}\n`);
}

function showDashboard() {
  const provider = getDefaultProvider();
  const providerDef = provider ? PROVIDERS[provider] : null;
  const workers = listWorkers();
  const running = workers.filter(w => w.status === 'running').length;
  const receipts = countReceipts();
  const mem = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);

  console.log(`\n  ${c.bold}${c.gold}⬡  NOOTERRA DASHBOARD${c.reset}\n`);
  console.log(hr());

  // Provider
  console.log(`\n  ${c.bold}PROVIDERS${c.reset}`);
  if (providerDef) {
    console.log(`    ${c.green}✓${c.reset} ${providerDef.name} (${providerDef.defaultModel}) ${c.dim}— primary${c.reset}`);
  } else {
    console.log(`    ${c.red}✗${c.reset} No provider connected`);
  }

  // Workers
  console.log(`\n  ${c.bold}WORKERS${c.reset}`);
  if (workers.length === 0) {
    console.log(`    ${c.dim}No workers. Type /new to create one.${c.reset}`);
  } else {
    for (const w of workers.slice(0, 8)) {
      const status = w.status === 'running' ? `${c.green}● running${c.reset}` :
                     w.status === 'error' ? `${c.red}✗ error${c.reset}` :
                     `${c.dim}○ idle${c.reset}`;
      const runs = w.stats?.totalRuns || 0;
      console.log(`    ${status}  ${w.charter?.name || w.id}  ${c.dim}${runs} runs${c.reset}`);
    }
  }

  // System
  console.log(`\n  ${c.bold}SYSTEM${c.reset}`);
  console.log(`    Workers: ${workers.length} total${running > 0 ? `, ${running} running` : ''}`);
  console.log(`    Receipts: ${receipts}`);
  console.log(`    Heap: ${heapMB}MB`);
  console.log(`    Node: ${process.version}`);
  console.log('');
}

function showLogs(nameOrId) {
  if (!nameOrId?.trim()) {
    console.log(`\n  ${c.dim}Usage: /logs <worker name>${c.reset}\n`);
    return;
  }
  const workers = listWorkers();
  const match = workers.find(w =>
    (w.charter?.name || '').toLowerCase().includes(nameOrId.trim().toLowerCase()) || w.id === nameOrId.trim()
  );
  if (!match) {
    console.log(`\n  ${c.red}✗${c.reset} Worker "${nameOrId.trim()}" not found.\n`);
    return;
  }
  try {
    const runsDir = path.join(os.homedir(), '.nooterra', 'runs');
    const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.json'));
    const receipts = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8')); } catch { return null; }
    }).filter(r => r && r.workerId === match.id)
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
      .slice(0, 15);

    console.log(`\n  ${c.bold}Logs: ${match.charter?.name}${c.reset} (${receipts.length} runs)\n`);
    if (receipts.length === 0) {
      console.log(`  ${c.dim}No runs yet. Use /run ${match.charter?.name}${c.reset}\n`);
      return;
    }
    for (const r of receipts) {
      const ok = r.success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
      const time = r.completedAt ? new Date(r.completedAt).toLocaleString() : '';
      const dur = r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '';
      const tools = r.toolCallCount || 0;
      const rounds = r.executionLog?.length || 0;
      const blocked = r.blockedActions?.length || 0;

      // Summarize tool names used
      const toolNames = [...new Set(
        (r.executionLog || []).flatMap(l => (l.toolCalls || []).map(tc => tc.name)).filter(Boolean)
      )].join(', ');

      console.log(`    ${ok} ${time}  ${c.dim}${dur}  ${rounds} round${rounds !== 1 ? 's' : ''}  ${tools} tool${tools !== 1 ? 's' : ''}${c.reset}`);
      if (toolNames) console.log(`      ${c.dim}Tools: ${toolNames}${c.reset}`);
      if (blocked > 0) console.log(`      ${c.red}${blocked} action${blocked !== 1 ? 's' : ''} blocked${c.reset}`);

      // Show response preview
      if (r.response) {
        const preview = r.response.split('\n').find(l => l.trim())?.trim().slice(0, 70);
        if (preview) console.log(`      ${c.dim}${preview}${preview.length >= 70 ? '...' : ''}${c.reset}`);
      }
    }
    console.log('');
  } catch {
    console.log(`\n  ${c.dim}No logs found.${c.reset}\n`);
  }
}

function showScheduleHelp(args) {
  if (!args?.trim() || args.trim() === 'list') {
    try {
      const schedFile = path.join(os.homedir(), '.nooterra', 'schedules.json');
      if (fs.existsSync(schedFile)) {
        const data = JSON.parse(fs.readFileSync(schedFile, 'utf8'));
        const schedules = data.schedules || [];
        if (schedules.length > 0) {
          console.log(`\n  ${c.bold}Schedules${c.reset}\n`);
          for (const s of schedules) {
            const icon = s.paused ? `${c.gold}⏸${c.reset}` : `${c.green}●${c.reset}`;
            console.log(`    ${icon} ${s.workerName || s.workerId} — ${c.gold}${s.cron}${c.reset}${s.paused ? ` ${c.dim}(paused)${c.reset}` : ''}`);
          }
          console.log('');
          return;
        }
      }
    } catch {}
    console.log(`\n  ${c.dim}No schedules. Workers with triggers auto-run via the daemon.${c.reset}\n`);
    return;
  }
  console.log(`
  ${c.bold}Schedule${c.reset}

  ${c.gold}/schedule list${c.reset}                       List all schedules
  ${c.gold}/schedule <worker> every 5m${c.reset}          Every 5 minutes
  ${c.gold}/schedule <worker> daily 9am${c.reset}         Daily at 9 AM
  ${c.gold}/schedule <worker> weekdays 9am${c.reset}      Weekdays at 9 AM
  ${c.gold}/schedule pause <id>${c.reset}                 Pause a schedule
  ${c.gold}/schedule delete <id>${c.reset}                Delete a schedule
`);
}

function showApprovals() {
  try {
    const appDir = path.join(os.homedir(), '.nooterra', 'approvals');
    if (!fs.existsSync(appDir)) {
      console.log(`\n  ${c.dim}No pending approvals.${c.reset}\n`);
      return;
    }
    const files = fs.readdirSync(appDir).filter(f => f.endsWith('.json'));
    const pending = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(appDir, f), 'utf8')); } catch { return null; }
    }).filter(a => a && a.status === 'pending');

    if (pending.length === 0) {
      console.log(`\n  ${c.dim}No pending approvals.${c.reset}\n`);
      return;
    }

    console.log(`\n  ${c.bold}Pending Approvals${c.reset} (${pending.length})\n`);
    for (const a of pending) {
      const age = a.requestedAt
        ? `${Math.round((Date.now() - new Date(a.requestedAt).getTime()) / 60000)}m ago`
        : '';
      console.log(`    ${c.gold}⚡${c.reset} ${a.workerName || 'Worker'}: ${(a.description || a.action || '').slice(0, 50)}`);
      console.log(`      ${c.dim}${age} — /approve ${a.id} or /deny ${a.id}${c.reset}`);
    }
    console.log('');
  } catch {
    console.log(`\n  ${c.dim}No pending approvals.${c.reset}\n`);
  }
}

function showCost() {
  try {
    const healthFile = path.join(os.homedir(), '.nooterra', 'provider-health.json');
    if (fs.existsSync(healthFile)) {
      const health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      console.log(`\n  ${c.bold}Cost Summary${c.reset}\n`);
      for (const [pid, data] of Object.entries(health)) {
        const name = PROVIDERS[pid]?.name || pid;
        const cost = data.totalCost ? `$${data.totalCost.toFixed(4)}` : '$0.00';
        const calls = data.totalCalls || 0;
        console.log(`    ${name}: ${c.gold}${cost}${c.reset} (${calls} calls)`);
      }
      console.log('');
      return;
    }
  } catch {}
  console.log(`\n  ${c.dim}No cost data yet. Run some workers first.${c.reset}\n`);
}

function showHealth() {
  try {
    const healthFile = path.join(os.homedir(), '.nooterra', 'provider-health.json');
    if (fs.existsSync(healthFile)) {
      const health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      console.log(`\n  ${c.bold}Provider Health${c.reset}\n`);
      for (const [pid, data] of Object.entries(health)) {
        const name = PROVIDERS[pid]?.name || pid;
        const cb = data.circuitBreaker || 'CLOSED';
        const icon = cb === 'CLOSED' ? `${c.green}✓${c.reset}` : cb === 'OPEN' ? `${c.red}✗${c.reset}` : `${c.gold}⚡${c.reset}`;
        const label = cb === 'CLOSED' ? 'healthy' : cb === 'OPEN' ? 'down' : 'testing';
        const latency = data.p95Latency ? `p95: ${data.p95Latency}ms` : '';
        console.log(`    ${icon} ${name}: ${label} ${c.dim}${latency}${c.reset}`);
      }
      console.log('');
      return;
    }
  } catch {}
  console.log(`\n  ${c.dim}No health data yet. Run some workers first.${c.reset}\n`);
}

function showDelegateHelp(args) {
  console.log(`
  ${c.bold}Worker Delegation${c.reset}

  Delegate tasks from one worker to another during execution.
  Workers can call __delegate_to_worker as a tool.

  ${c.gold}/delegate <from> to <to> "<task>"${c.reset}

  Example:
    /delegate "sales lead" to "Price Monitor" "check competitor pricing"

  Features:
    ${c.dim}•${c.reset} Transitive trust with attenuation (delegations inherit constraints)
    ${c.dim}•${c.reset} Max depth of 3 to prevent infinite loops
    ${c.dim}•${c.reset} Full audit trail of all delegations
    ${c.dim}•${c.reset} Results flow back to parent worker
`);
}

// ── Teach Worker ────────────────────────────────────────────────────────────
async function teachWorker(args, rl) {
  if (!args?.trim()) {
    console.log(`
  ${c.bold}Teach a worker${c.reset} — give it company knowledge

  ${c.gold}/teach <worker> "your info here"${c.reset}     Add text knowledge
  ${c.gold}/teach <worker> https://...${c.reset}           Add from URL
  ${c.gold}/teach <worker> ~/file.txt${c.reset}            Add from file
  ${c.gold}/teach <worker> --list${c.reset}                See what it knows
  ${c.gold}/teach <worker> --clear${c.reset}               Remove all knowledge

  Examples:
    /teach "Price Monitor" "Competitor list: Acme Corp, Globex, Initech"
    /teach "Support Bot" https://company.com/faq
    /teach "Support Bot" "Our refund policy is 30 days no questions asked"
`);
    return;
  }

  // Parse: first token is worker name (possibly quoted), rest is the knowledge
  let workerName, knowledge;
  const quoteMatch = args.match(/^"([^"]+)"\s+(.*)/s);
  if (quoteMatch) {
    workerName = quoteMatch[1];
    knowledge = quoteMatch[2].trim();
  } else {
    const parts = args.split(/\s+/);
    workerName = parts[0];
    knowledge = parts.slice(1).join(' ').trim();
  }

  // Find the worker
  const workers = listWorkers();
  const match = workers.find(w =>
    (w.charter?.name || '').toLowerCase().includes(workerName.toLowerCase()) || w.id === workerName
  );
  if (!match) {
    console.log(`\n  ${c.red}✗${c.reset} Worker "${workerName}" not found. Type /workers to see all.\n`);
    return;
  }

  try {
    const { KnowledgeStore, addKnowledgeFromInput } = await import('./worker-knowledge.mjs');
    const store = new KnowledgeStore(match.id);

    if (knowledge === '--list') {
      const items = store.getItems();
      const stats = store.getStats();
      if (items.length === 0) {
        console.log(`\n  ${c.dim}${match.charter?.name} has no knowledge yet. Teach it something!${c.reset}\n`);
        return;
      }
      console.log(`\n  ${c.bold}Knowledge: ${match.charter?.name}${c.reset} (${stats.itemCount} items, ${(stats.totalChars / 1024).toFixed(1)}KB)\n`);
      for (const item of items.slice(0, 15)) {
        const preview = (item.content || '').split('\n')[0].slice(0, 60);
        console.log(`    ${c.dim}${item.type}${c.reset}  ${item.label || 'untitled'}  ${c.dim}${preview}...${c.reset}`);
      }
      console.log('');
      return;
    }

    if (knowledge === '--clear') {
      store.clear();
      console.log(`\n  ${c.green}✓${c.reset} Cleared all knowledge for ${match.charter?.name}.\n`);
      return;
    }

    if (!knowledge) {
      // Interactive: ask for knowledge
      console.log(`\n  ${c.bold}What should ${match.charter?.name} know?${c.reset}`);
      console.log(`  ${c.dim}Type text, paste a URL, or enter a file path. Type 'done' when finished.${c.reset}\n`);

      let added = 0;
      while (true) {
        const input = await ask(rl, `  ${c.gold}>${c.reset} `);
        if (!input.trim() || input.trim().toLowerCase() === 'done') break;
        const result = await addKnowledgeFromInput(store, input.trim());
        if (result.success) {
          console.log(`  ${c.green}✓${c.reset} Added: ${result.label} (${result.chars} chars)`);
          added++;
        } else {
          console.log(`  ${c.red}✗${c.reset} ${result.error}`);
        }
      }
      console.log(`\n  ${c.green}✓${c.reset} ${added} item${added !== 1 ? 's' : ''} added to ${match.charter?.name}.\n`);
      return;
    }

    // Add the knowledge directly
    const result = await addKnowledgeFromInput(store, knowledge);
    if (result.success) {
      const stats = store.getStats();
      console.log(`\n  ${c.green}✓${c.reset} Taught ${match.charter?.name}: ${result.label} (${result.chars} chars)`);
      console.log(`  ${c.dim}Total knowledge: ${stats.itemCount} items, ${(stats.totalChars / 1024).toFixed(1)}KB${c.reset}\n`);
    } else {
      console.log(`\n  ${c.red}✗${c.reset} ${result.error}\n`);
    }
  } catch (err) {
    console.log(`\n  ${c.red}✗${c.reset} ${err.message}\n`);
  }
}

// ── Instant Worker Creation ─────────────────────────────────────────────────
async function instantCreateWorker(rl, description) {
  const context = await instantCreate(description);
  const charter = buildCharterFromContext(context);
  const provider = getDefaultProvider() || 'chatgpt';
  const providerDef = PROVIDERS[provider] || PROVIDERS.openai;

  // Show what we inferred
  console.log(`\n  ${c.bold}${c.green}⚡ Instant worker:${c.reset}\n`);
  printCharter(charter);
  console.log('');

  const capNames = (charter.capabilities || []).map(cap => cap.name || cap.id).join(', ');
  const scheduleStr = charter.schedule ? (charter.schedule.type === 'interval' ? `every ${charter.schedule.value}` : charter.schedule.type === 'cron' ? `cron: ${charter.schedule.value}` : charter.schedule.type) : 'on demand';

  console.log(`  ${c.dim}Provider: ${providerDef.name} · Schedule: ${scheduleStr} · Tools: ${capNames || 'none'}${c.reset}\n`);

  // Pre-flight: warn about capabilities that need connections
  const caps = charter.capabilities || [];
  const warnings = [];
  for (const cap of caps) {
    const id = cap.id || cap;
    // These need tokens/auth
    if (['slack', 'email', 'github', 'discord', 'stripe', 'shopify', 'postgres', 'notion', 'googleSheets', 'calendar'].includes(id)) {
      warnings.push(`  ${c.gold}⚡${c.reset} ${cap.name || id} needs setup — run /connect ${id} after deploy`);
    }
  }
  if (warnings.length > 0) {
    console.log(`  ${c.bold}Setup needed after deploy:${c.reset}`);
    for (const w of warnings) console.log(w);
    console.log('');
  }

  console.log(`  ${c.bold}Deploy this worker?${c.reset} ${c.dim}(yes / edit / cancel)${c.reset}\n`);

  const answer = await ask(rl, `  ${c.gold}>${c.reset} `);
  const trimmed = (answer || '').trim().toLowerCase();

  if (/^(y|yes|go|deploy|ship|create|do it|ok)/.test(trimmed)) {
    const worker = createWorker(charter, {
      provider, model: providerDef.defaultModel,
      triggers: context.schedule?.type !== 'trigger' ? [{
        type: TRIGGER_TYPES.SCHEDULE, config: { schedule: context.schedule }
      }] : []
    });
    console.log(`\n  ${c.green}✓${c.reset} ${c.bold}${worker.charter.name}${c.reset} deployed!`);
    console.log(`  ${c.dim}Want to test it? Type: /run ${worker.charter.name}${c.reset}\n`);
    return worker;
  }

  if (/^(edit|change|modify|tweak)/.test(trimmed)) {
    // Fall through to full conversation mode
    return createWorkerFlow(rl, description);
  }

  console.log(`\n  ${c.dim}Cancelled.${c.reset}\n`);
  return null;
}

// ── Template Picker ────────────────────────────────────────────────────────
async function showTemplates(rl) {
  console.log(`\n  ${c.bold}Quick Start Templates${c.reset}\n`);
  console.log(`  ${c.dim}Pick a template to deploy in seconds:${c.reset}\n`);

  for (let i = 0; i < WORKER_TEMPLATES.length; i++) {
    const t = WORKER_TEMPLATES[i];
    console.log(`    ${c.gold}${i + 1}${c.reset}  ${t.icon} ${c.bold}${t.name}${c.reset}`);
    console.log(`       ${c.dim}${t.description}${c.reset}`);
  }

  console.log(`\n    ${c.gold}0${c.reset}  ${c.dim}Cancel${c.reset}\n`);

  const choice = await ask(rl, `  ${c.gold}>${c.reset} `);
  const num = parseInt((choice || '').trim(), 10);

  if (num > 0 && num <= WORKER_TEMPLATES.length) {
    const template = WORKER_TEMPLATES[num - 1];
    const charter = buildCharterFromContext(template.context);
    const provider = getDefaultProvider() || 'chatgpt';
    const providerDef = PROVIDERS[provider] || PROVIDERS.openai;

    console.log('');
    printCharter(charter);
    console.log(`\n  ${c.bold}Deploy ${template.name}?${c.reset} ${c.dim}(yes / edit / cancel)${c.reset}\n`);

    const answer = await ask(rl, `  ${c.gold}>${c.reset} `);
    if (/^(y|yes|go|deploy|ship)/.test((answer || '').trim().toLowerCase())) {
      const worker = createWorker(charter, {
        provider, model: providerDef.defaultModel,
        triggers: template.context.schedule?.type !== 'trigger' ? [{
          type: TRIGGER_TYPES.SCHEDULE, config: { schedule: template.context.schedule }
        }] : []
      });
      console.log(`\n  ${c.green}✓${c.reset} ${c.bold}${worker.charter.name}${c.reset} deployed!`);
      console.log(`  ${c.dim}Run it: /run ${worker.charter.name}${c.reset}\n`);
      return worker;
    }
  }

  console.log(`\n  ${c.dim}Cancelled.${c.reset}\n`);
  return null;
}

// ── Natural Language Detection ──────────────────────────────────────────────
function looksLikeWorkerRequest(input) {
  const lower = input.toLowerCase();
  const patterns = [
    /^i want/, /^i need/, /^create/, /^make/, /^build/, /^help me/,
    /^can you/, /^set up/, /^monitor/, /^watch/, /^check/, /^track/,
    /^send/, /^forward/, /^process/, /^automate/, /^schedule/,
    /worker that/, /bot that/, /agent that/
  ];
  return patterns.some(p => p.test(lower));
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);

  // Ensure base directory exists
  fs.mkdirSync(NOOTERRA_DIR, { recursive: true });

  // ── Non-interactive flag commands (no banner, no REPL) ─────────────────
  const flagIdx = argv.findIndex(a => a.startsWith('--'));
  if (flagIdx >= 0) {
    const flag = argv[flagIdx];
    const flagArg = argv.slice(flagIdx + 1).join(' ').trim();

    switch (flag) {
      case '--workers': showWorkers(); return;
      case '--dashboard': case '--dash': showDashboard(); return;
      case '--approvals': showApprovals(); return;
      case '--cost': showCost(); return;
      case '--health': showHealth(); return;
      case '--logs': showLogs(flagArg); return;
      case '--schedule': showScheduleHelp(flagArg); return;
      case '--run':
        await runWorker(flagArg);
        return;
      case '--teach':
        await teachWorker(flagArg, null);
        return;
      case '--new':
        // New worker flow needs the REPL — fall through below
        break;
      default:
        // Unknown flag — fall through to interactive mode
        break;
    }
  }

  const isNewFlag = argv.includes('--new');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY !== false
  });

  // Show banner
  clearScreen();
  printBanner();

  // Check if we need onboarding
  const hasProvider = getConfiguredProviders().length > 0;

  if (!hasProvider) {
    const success = await runOnboarding(rl);
    if (!success) {
      console.log(`  ${c.dim}You can always connect later with /auth${c.reset}\n`);
    }
  }

  // Show status bar
  console.log(hr());
  console.log(statusBar());
  console.log(hr());

  // If --new flag, jump straight to creation
  if (isNewFlag) {
    console.log(`\n  ${c.bold}Create a new worker${c.reset}`);
    console.log(`  ${c.dim}Describe what you want this worker to do.${c.reset}\n`);
    const desc = await ask(rl, `  ${c.gold}>${c.reset} `);
    if (desc.trim()) {
      await createWorkerFlow(rl, desc);
    }
  } else {
    // Welcome message
    const workers = listWorkers();
    if (workers.length === 0) {
      console.log(`\n  ${c.dim}Describe what you need and I'll create a worker for it.${c.reset}`);
      console.log(`  ${c.dim}Or type /help to see all commands.${c.reset}\n`);
    } else {
      console.log(`\n  ${c.dim}Type /help for commands, /workers to see your workers,${c.reset}`);
      console.log(`  ${c.dim}or describe a new job to create a worker.${c.reset}\n`);
    }
  }

  // ── Main REPL Loop ──────────────────────────────────────────────────────
  const promptStr = `  ${c.gold}>${c.reset} `;

  function doPrompt() {
    rl.question(promptStr, async (input) => {
      const trimmed = (input || '').trim();

      if (!trimmed) {
        doPrompt();
        return;
      }

      // /commands
      if (trimmed.startsWith('/')) {
        const spaceIdx = trimmed.indexOf(' ');
        const cmd = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
        const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';
        await handleCommand(cmd.toLowerCase(), args, rl);
        doPrompt();
        return;
      }

      // Natural language → instant worker creation (one sentence → working worker)
      if (looksLikeWorkerRequest(trimmed)) {
        await instantCreateWorker(rl, trimmed);
        doPrompt();
        return;
      }

      // Anything else — try instant mode
      console.log(`\n  ${c.cyan}Nooterra:${c.reset} I'll create a worker for that.\n`);
      await instantCreateWorker(rl, trimmed);
      doPrompt();
    });
  }

  doPrompt();

  rl.on('close', () => {
    console.log(`\n  ${c.dim}Goodbye.${c.reset}\n`);
    process.exit(0);
  });
}

main().catch(err => {
  console.error(`\n  ${c.red}Fatal:${c.reset} ${err.message}\n`);
  process.exit(1);
});
