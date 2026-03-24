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

import { createConversation, processInput, CONVERSATION_STATES } from './worker-builder-core.mjs';
import { createWorker, listWorkers, loadWorker, findWorkerByName, WORKER_STATUS } from './worker-persistence.mjs';
import {
  PROVIDERS, isProviderConfigured, getDefaultProvider, setDefaultProvider,
  saveApiKey, loadApiKey, getConfiguredProviders, loadOAuthTokens,
  runChatGPTOAuthFlow, loadProviderCredential
} from './provider-auth.mjs';
import { buildCharterFromContext, generateCharterSummary } from './charter-compiler.mjs';
import { TRIGGER_TYPES } from './trigger-engine.mjs';

const VERSION = '0.3.0';
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

  ${c.gold}/new${c.reset} [description]     Create a new worker
  ${c.gold}/workers${c.reset}               List all workers
  ${c.gold}/run${c.reset} <name>            Run a worker now
  ${c.gold}/stop${c.reset} <name>           Stop a worker
  ${c.gold}/status${c.reset}                System status
  ${c.gold}/receipts${c.reset}              Recent receipts
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

  console.log(`\n  ${c.dim}Running ${match.charter.name}...${c.reset}\n`);

  try {
    const { runWorkerExecution } = await import('./worker-daemon.mjs');
    const { getConnectionManager } = await import('./mcp-integration.mjs');

    const credential = await loadProviderCredential(provider);
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

    const result = await runWorkerExecution(match, mcpManager, notificationBus, credential);

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
  const isNewFlag = argv.includes('--new');
  const isWorkersList = argv.includes('--workers');

  // Ensure base directory exists
  fs.mkdirSync(NOOTERRA_DIR, { recursive: true });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY !== false
  });

  // Show banner
  clearScreen();
  printBanner();

  // --workers flag: just list and exit
  if (isWorkersList) {
    showWorkers();
    rl.close();
    return;
  }

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

      // Natural language → worker creation
      if (looksLikeWorkerRequest(trimmed)) {
        await createWorkerFlow(rl, trimmed);
        doPrompt();
        return;
      }

      // Anything else — try as worker creation anyway
      console.log(`\n  ${c.cyan}Nooterra:${c.reset} I'll help you create a worker for that.\n`);
      await createWorkerFlow(rl, trimmed);
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
