/**
 * Nooterra TUI — Main App Component
 *
 * Manages views, state, and routing between screens.
 * Renders inline (no alternate screen) with Ink.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { TextInput, Select, Spinner } from '@inkjs/ui';

import { palette, icons } from './theme.mjs';
import WelcomeBox from './WelcomeBox.mjs';
import CommandPalette, { COMMANDS } from './CommandPalette.mjs';
import { renderMessage } from './Messages.mjs';
import WorkersScreen from './WorkersScreen.mjs';
import DashboardScreen from './DashboardScreen.mjs';
import ExecutionView from './ExecutionView.mjs';

import { createConversation, processInput, instantCreate, WORKER_TEMPLATES, CONVERSATION_STATES } from '../worker-builder-core.mjs';
import { createWorker, listWorkers, WORKER_STATUS } from '../worker-persistence.mjs';
import {
  PROVIDERS, getDefaultProvider, setDefaultProvider,
  saveApiKey, getConfiguredProviders, runChatGPTOAuthFlow, loadProviderCredential
} from '../provider-auth.mjs';
import { buildCharterFromContext } from '../charter-compiler.mjs';
import { TRIGGER_TYPES } from '../trigger-engine.mjs';

import fs from 'fs';
import path from 'path';
import os from 'os';

const RUNS_DIR = path.join(os.homedir(), '.nooterra', 'runs');

function countReceipts() {
  try { return fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).length; } catch { return 0; }
}

function getRecentReceipts(limit = 8) {
  try {
    return fs.readdirSync(RUNS_DIR)
      .filter(f => f.endsWith('.json'))
      .sort().reverse().slice(0, limit)
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// ── Intent detection ─────────────────────────────────────────────────────
function looksLikeWorkerRequest(input) {
  const lower = input.toLowerCase();
  const patterns = [
    /^(i want|i need|create|make|build|set up|help me make|help me create)/,
    /^(can you|could you).*(worker|bot|agent|monitor|automate)/,
    /worker that|bot that|agent that|monitor my|automate my|check my/,
    /^(monitor|watch|track|check|send|forward|process|schedule|automate)/,
  ];
  return patterns.some(p => p.test(lower));
}

// ── StatusBar ────────────────────────────────────────────────────────────
function StatusBar({ view }) {
  const { stdout } = useStdout();
  const w = stdout?.columns || 80;
  const provider = getDefaultProvider();
  const provName = provider ? (PROVIDERS[provider]?.name || provider) : 'not connected';
  const workers = listWorkers();

  const statusText = view !== 'chat'
    ? `  ${provName} ${icons.bullet} ${workers.length} worker${workers.length !== 1 ? 's' : ''} ${icons.bullet} ctrl+c exit ${icons.bullet} esc back`
    : `  ${provName} ${icons.bullet} ${workers.length} worker${workers.length !== 1 ? 's' : ''} ${icons.bullet} ctrl+c exit`;

  return React.createElement(Box, { marginTop: 0, paddingX: 0, width: w - 2 },
    React.createElement(Text, { color: palette.textMuted, wrap: 'truncate-end' }, statusText)
  );
}

// ── HelpScreen ──────────────────────────────────────────────────────────
function HelpScreen({ onBack }) {
  useInput((_, key) => { if (key.escape) onBack(); });

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2, marginTop: 1 },
    React.createElement(Text, { bold: true }, 'Commands'),
    React.createElement(Text, null, ''),
    ...COMMANDS.map(cmd =>
      React.createElement(Box, { key: cmd.name, gap: 1 },
        React.createElement(Box, { width: 24 },
          React.createElement(Text, { color: palette.gold }, `  ${cmd.name}`)
        ),
        React.createElement(Text, { color: palette.textDim }, cmd.desc)
      )
    ),
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: palette.textDim },
      '  Or just type naturally \u2014 "I need a worker that monitors..."'
    ),
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: palette.textMuted }, '  Press Esc to go back'),
  );
}

// ── ReceiptsScreen ──────────────────────────────────────────────────────
function ReceiptsScreen({ onBack }) {
  const receipts = getRecentReceipts();
  useInput((_, key) => { if (key.escape) onBack(); });

  if (receipts.length === 0) {
    return React.createElement(Box, { flexDirection: 'column', marginLeft: 2, marginTop: 1 },
      React.createElement(Text, { bold: true }, 'Receipts'),
      React.createElement(Text, null, ''),
      React.createElement(Text, { color: palette.textDim }, '  No receipts yet. Run a worker to generate one.'),
      React.createElement(Text, null, ''),
      React.createElement(Text, { color: palette.textMuted }, '  Press Esc to go back'),
    );
  }

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2, marginTop: 1 },
    React.createElement(Text, { bold: true }, 'Receipts'),
    React.createElement(Text, null, ''),
    ...receipts.map((r, i) => {
      const ok = r.success || r.status === 'completed';
      const icon = ok ? icons.success : icons.failure;
      const color = ok ? palette.success : palette.error;
      const time = r.completedAt || r.timestamp || '';
      const short = time ? new Date(time).toLocaleString() : '';
      const dur = r.duration ? `(${r.duration}ms)` : '';

      return React.createElement(Box, { key: i, gap: 1, marginLeft: 1 },
        React.createElement(Text, { color }, icon),
        React.createElement(Box, { width: 26 },
          React.createElement(Text, { bold: true }, r.workerName || 'Worker')
        ),
        React.createElement(Text, { color: palette.textDim }, short),
        React.createElement(Text, { color: palette.textMuted }, dur),
      );
    }),
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: palette.textMuted }, '  \u2191\u2193 navigate \u00B7 Esc to go back'),
  );
}

// ── OnboardingScreen ────────────────────────────────────────────────────
function OnboardingScreen({ onComplete }) {
  const [phase, setPhase] = useState('select');
  const [selectedProvider, setSelectedProvider] = useState(null);

  const options = [
    { label: 'ChatGPT (use your subscription — recommended)', value: 'chatgpt' },
    { label: 'OpenAI API key', value: 'openai' },
    { label: 'Anthropic API key', value: 'anthropic' },
    { label: 'OpenRouter (200+ models)', value: 'openrouter' },
    { label: 'Groq (fast, free tier)', value: 'groq' },
    { label: 'Local (Ollama — free, runs on your machine)', value: 'local' },
  ];

  const handleSelect = useCallback(async ({ value }) => {
    if (value === 'chatgpt') {
      setPhase('oauth');
      try {
        await runChatGPTOAuthFlow();
        setDefaultProvider('chatgpt');
        onComplete('chatgpt');
      } catch (err) {
        setPhase('error');
        setTimeout(() => onComplete(null), 2000);
      }
    } else if (value === 'local') {
      setDefaultProvider('local');
      onComplete('local');
    } else {
      setSelectedProvider(value);
      setPhase('apikey');
    }
  }, [onComplete]);

  if (phase === 'oauth') {
    return React.createElement(Box, { marginLeft: 1, flexDirection: 'column' },
      React.createElement(Spinner, { label: 'Connecting to ChatGPT... sign in via your browser' }),
    );
  }

  if (phase === 'error') {
    return React.createElement(Box, { marginLeft: 1 },
      React.createElement(Text, { color: palette.error }, `${icons.failure} OAuth failed. Try /auth later.`)
    );
  }

  if (phase === 'apikey') {
    const provName = PROVIDERS[selectedProvider]?.name || selectedProvider;
    return React.createElement(Box, { marginLeft: 1, flexDirection: 'column' },
      React.createElement(Text, null, `Paste your ${provName} API key:`),
      React.createElement(Box, { marginTop: 1 },
        React.createElement(Text, { color: palette.gold }, `${icons.arrow} `),
        React.createElement(TextInput, {
          placeholder: 'sk-...',
          onSubmit: (key) => {
            if (key.trim()) {
              saveApiKey(selectedProvider, key.trim());
              setDefaultProvider(selectedProvider);
              onComplete(selectedProvider);
            }
          }
        })
      )
    );
  }

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2, marginTop: 1 },
    React.createElement(Text, { bold: true }, 'Welcome to Nooterra.'),
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: palette.textDim }, 'How should your workers think?'),
    React.createElement(Text, null, ''),
    React.createElement(Select, { options, onChange: handleSelect }),
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: palette.textMuted }, 'Press \u2191\u2193 to navigate \u00B7 Enter to select'),
  );
}

// ── ChatInput ───────────────────────────────────────────────────────────
function ChatInput({ onSubmit }) {
  const { stdout } = useStdout();
  const w = stdout?.columns || 80;
  const [currentInput, setCurrentInput] = useState('');
  const [inputKey, setInputKey] = useState(0); // Increment to reset TextInput

  const showPalette = currentInput.startsWith('/') && currentInput.length >= 1;

  const lineWidth = w > 4 ? w - 2 : 78;

  return React.createElement(Box, { flexDirection: 'column' },
    // Top separator
    React.createElement(Text, { color: palette.border },
      '\u2500'.repeat(lineWidth)
    ),
    // Input
    React.createElement(Box, { paddingX: 0 },
      React.createElement(Text, { color: palette.gold }, `${icons.arrow} `),
      React.createElement(TextInput, {
        key: `input-${inputKey}`,
        placeholder: 'Describe a worker or type / for commands...',
        suggestions: COMMANDS.map(c => c.name),
        onChange: setCurrentInput,
        onSubmit: (val) => {
          setCurrentInput('');
          setInputKey(k => k + 1); // Force remount to clear input
          onSubmit(val);
        },
      })
    ),
    // Bottom separator
    React.createElement(Text, { color: palette.border },
      '\u2500'.repeat(lineWidth)
    ),
    // Command palette dropdown BELOW input (shown when typing /)
    showPalette
      ? React.createElement(CommandPalette, { filter: currentInput })
      : null,
    // Status bar
    React.createElement(StatusBar, { view: 'chat' }),
  );
}

// ── Main App ────────────────────────────────────────────────────────────
export default function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [view, setView] = useState(() => {
    return getConfiguredProviders().length > 0 ? 'chat' : 'onboarding';
  });
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [inputValue, setInputValue] = useState('');

  const addMessage = useCallback((role, content) => {
    setMessages(prev => [...prev, { role, content, id: Date.now() + Math.random() }]);
  }, []);

  // Auto-start daemon if workers with triggers exist (silently)
  useEffect(() => {
    const workers = listWorkers();
    const hasTriggered = workers.some(w => w.triggers && w.triggers.length > 0);
    if (hasTriggered) {
      // Suppress daemon console output when running inside TUI
      const origLog = console.log;
      const origError = console.error;
      import('../worker-daemon.mjs').then(({ WorkerDaemon }) => {
        try {
          const status = WorkerDaemon.getStatus();
          if (!status.running) {
            console.log = () => {};
            console.error = () => {};
            const daemon = new WorkerDaemon();
            daemon.start().then(() => {
              console.log = origLog;
              console.error = origError;
            }).catch(() => {
              console.log = origLog;
              console.error = origError;
            });
          }
        } catch {
          console.log = origLog;
          console.error = origError;
        }
      }).catch(() => {});
    }
  }, []);

  // Chat with AI (non-worker-creation messages)
  const chatHistory = React.useRef([]);

  const handleChat = useCallback(async (userMessage) => {
    const provider = getDefaultProvider();
    if (!provider) {
      addMessage('nooterra', "I can't chat yet — no AI provider connected. Type /auth to set one up, or describe a worker to create one.");
      return;
    }

    setLoading(true);
    chatHistory.current.push({ role: 'user', content: userMessage });

    try {
      const credential = await loadProviderCredential(provider);
      if (!credential) {
        addMessage('nooterra', "No credentials found. Run /auth to reconnect.");
        setLoading(false);
        return;
      }

      const systemPrompt = `You are Nooterra, an AI assistant that helps users create and manage AI workers. You can:
- Create workers that run 24/7 with guardrails (type /new or describe a job)
- Run existing workers (/run <name>)
- Manage workers (/workers)
- Answer questions about what Nooterra can do

Be helpful, concise, and friendly. If the user seems to want a worker, suggest they describe the job.
The user has ${listWorkers().length} workers and is using ${PROVIDERS[provider]?.name || provider}.`;

      const { callProvider } = await import('../worker-daemon.mjs');
      const provDef = PROVIDERS[provider] || PROVIDERS.openai;
      const result = await callProvider(
        provider,
        credential,
        provDef.defaultModel,
        systemPrompt,
        chatHistory.current.slice(-10), // Last 10 messages for context
        []
      );

      const response = result.content || "I'm not sure how to respond to that. Try describing a worker you'd like to create!";
      chatHistory.current.push({ role: 'assistant', content: response });
      addMessage('nooterra', response);
    } catch (err) {
      addMessage('nooterra', `I couldn't process that: ${err.message}. Try /help for commands.`);
    }
    setLoading(false);
  }, [addMessage]);

  // Handle onboarding complete
  const handleOnboardingComplete = useCallback((provider) => {
    setView('chat');
    if (provider) {
      addMessage('success', `Connected to ${PROVIDERS[provider]?.name || provider}!`);
      // Immediately start worker creation conversation
      addMessage('nooterra', "Let's create your first worker. What kind of job do you need done?");
      setConversation(createConversation());
    }
  }, [addMessage]);

  // Run a worker
  const handleRunWorker = useCallback(async (nameOrId) => {
    const workers = listWorkers();
    const match = workers.find(w =>
      (w.charter?.name || '').toLowerCase().includes(nameOrId.toLowerCase()) || w.id === nameOrId
    );
    if (!match) { addMessage('error', `Worker "${nameOrId}" not found.`); return; }

    const provider = match.provider || getDefaultProvider();
    if (!provider) { addMessage('error', 'No AI provider. Run /auth.'); return; }

    setLoading(true);
    addMessage('system', `Running ${match.charter.name}...`);

    try {
      const { runWorkerExecution } = await import('../worker-daemon.mjs');
      const { getConnectionManager } = await import('../mcp-integration.mjs');
      const credential = await loadProviderCredential(provider);
      if (!credential) { addMessage('error', 'No credentials. Run /auth.'); setLoading(false); return; }

      const mcpManager = getConnectionManager();
      const bus = { notify: async (ev, d) => addMessage('system', `${icons.warning} ${d.action || ev}`) };
      const result = await runWorkerExecution(match, mcpManager, bus, credential);

      if (result.response) addMessage('worker-output', result.response);
      addMessage('success', `${match.charter.name} — ${result.duration}ms (receipt: ${result.receipt?.taskId})`);
    } catch (err) {
      addMessage('error', `Failed: ${err.message}`);
    }
    setLoading(false);
  }, [addMessage]);

  // Handle commands
  const handleCommand = useCallback(async (input) => {
    const [cmd, ...rest] = input.trim().split(' ');
    const args = rest.join(' ').trim();

    switch (cmd.toLowerCase()) {
      case '/help': setView('help'); return;
      case '/workers': setView('workers'); return;
      case '/receipts': setView('receipts'); return;
      case '/status': {
        const p = getDefaultProvider(); const pd = p ? PROVIDERS[p] : null;
        addMessage('system',
          `Provider: ${pd ? `${pd.name} (${pd.defaultModel})` : 'none'}\n` +
          `Workers: ${listWorkers().length}\n` +
          `Receipts: ${countReceipts()}`
        );
        return;
      }
      case '/new':
        addMessage('nooterra', 'What kind of worker do you want to create? Just describe it in one sentence.');
        setConversation(createConversation());
        return;
      case '/templates': {
        const lines = WORKER_TEMPLATES.map((t, i) =>
          `  ${i + 1}. ${t.icon} **${t.name}** — ${t.description}`
        );
        addMessage('system',
          `Quick Start Templates:\n\n${lines.join('\n')}\n\n` +
          `Type the number to deploy, or describe your own worker.`
        );
        return;
      }
      case '/run':
        if (!args) { addMessage('system', 'Usage: /run <worker name>'); return; }
        await handleRunWorker(args);
        return;
      case '/connect': {
        if (!args) {
          addMessage('system', [
            'Connect a tool for your workers:',
            '',
            '  /connect slack <bot-token>     Connect Slack',
            '  /connect github <token>        Connect GitHub',
            '  /connect browser               Connect browser (no auth needed)',
            '  /connect filesystem <path>     Connect filesystem access',
            '',
            'Tokens are saved to ~/.nooterra/credentials/',
          ].join('\n'));
          return;
        }
        const [tool, ...tokenParts] = args.split(' ');
        const token = tokenParts.join(' ').trim();
        const toolLower = tool.toLowerCase();

        if (['browser', 'filesystem', 'memory', 'fetch'].includes(toolLower)) {
          // No auth needed — just verify it works
          try {
            const { getConnectionManager } = await import('../mcp-integration.mjs');
            const mgr = getConnectionManager();
            addMessage('system', `Connecting ${tool}...`);
            const result = await mgr.connect(toolLower);
            if (result.success) {
              addMessage('success', `${tool} connected! Workers can now use it.`);
            } else {
              addMessage('error', `Failed: ${result.error}`);
            }
          } catch (err) {
            addMessage('error', `Connection failed: ${err.message}`);
          }
          return;
        }

        if (!token) {
          addMessage('system', `Usage: /connect ${tool} <token>\nGet your token from the service's settings.`);
          return;
        }

        // Save token as env var for MCP server
        const envMap = { slack: 'SLACK_BOT_TOKEN', github: 'GITHUB_TOKEN', 'brave-search': 'BRAVE_API_KEY' };
        const envVar = envMap[toolLower];
        if (envVar) {
          process.env[envVar] = token;
          // Also persist to credentials dir
          const credDir = path.join(os.homedir(), '.nooterra', 'credentials');
          fs.mkdirSync(credDir, { recursive: true, mode: 0o700 });
          fs.writeFileSync(path.join(credDir, `${toolLower}-token.txt`), token, { mode: 0o600 });
          addMessage('success', `${tool} token saved. Workers can now use ${tool}.`);
        } else {
          addMessage('system', `Unknown tool: ${tool}. Try: slack, github, browser, filesystem`);
        }
        return;
      }
      case '/auth': setView('onboarding'); return;
      case '/model': {
        const prov = getDefaultProvider();
        const pd = prov ? PROVIDERS[prov] : null;
        if (!pd) { addMessage('system', 'No provider connected. Run /auth.'); return; }
        if (!args) {
          addMessage('system', `Current model: ${pd.defaultModel}\nAvailable: ${pd.models.join(', ')}\nUsage: /model <name>`);
          return;
        }
        // Check if the model exists in the provider's list
        const modelMatch = pd.models.find(m => m.toLowerCase().includes(args.toLowerCase()));
        if (modelMatch) {
          pd.defaultModel = modelMatch;
          addMessage('success', `Model changed to ${modelMatch}`);
        } else {
          addMessage('system', `Model "${args}" not found. Available: ${pd.models.join(', ')}`);
        }
        return;
      }
      case '/dashboard': case '/dash': setView('dashboard'); return;
      case '/schedule': {
        if (!args) {
          addMessage('system', [
            'Schedule recurring worker runs:',
            '',
            '  /schedule <worker> every 5m       Every 5 minutes',
            '  /schedule <worker> every 2h       Every 2 hours',
            '  /schedule <worker> daily 9am      Daily at 9 AM',
            '  /schedule <worker> weekdays 9am   Weekdays at 9 AM',
            '  /schedule list                    List all schedules',
            '  /schedule pause <id>              Pause a schedule',
            '  /schedule delete <id>             Delete a schedule',
          ].join('\n'));
          return;
        }
        if (args === 'list') {
          try {
            const { createScheduler } = await import('../worker-scheduler.mjs');
            const sched = createScheduler();
            const all = sched.list();
            if (all.length === 0) { addMessage('system', 'No schedules.'); return; }
            const lines = all.map(s =>
              `  ${s.paused ? icons.warning : icons.success} ${s.workerName || s.workerId} — ${s.cron}${s.paused ? ' (paused)' : ''}`
            );
            addMessage('system', `Schedules:\n${lines.join('\n')}`);
          } catch { addMessage('system', 'Scheduler not available yet.'); }
          return;
        }
        addMessage('system', 'Scheduler integration coming soon. Workers with schedules auto-run via the daemon.');
        return;
      }
      case '/approvals': case '/approve': case '/deny': {
        try {
          const { createApprovalEngine } = await import('../approval-engine.mjs');
          const engine = createApprovalEngine();
          if (cmd === '/approve' && args) {
            engine.respond(args, 'approved', 'tui-user');
            addMessage('success', `Approved: ${args}`);
            return;
          }
          if (cmd === '/deny' && args) {
            engine.respond(args, 'denied', 'tui-user');
            addMessage('success', `Denied: ${args}`);
            return;
          }
          const pending = engine.getPending();
          if (pending.length === 0) {
            addMessage('system', 'No pending approvals.');
          } else {
            const lines = pending.map(a =>
              `  ${icons.warning} ${a.workerName || 'Worker'}: ${(a.description || a.action || '').slice(0, 50)}\n    /approve ${a.id}  or  /deny ${a.id}`
            );
            addMessage('system', `Pending approvals:\n${lines.join('\n\n')}`);
          }
        } catch { addMessage('system', 'Approval engine not available yet.'); }
        return;
      }
      case '/cost': {
        try {
          const { createProviderRouter } = await import('../provider-fallback.mjs');
          const router = createProviderRouter();
          const summary = router.getCostSummary();
          const lines = Object.entries(summary).map(([p, data]) =>
            `  ${PROVIDERS[p]?.name || p}: $${(data.totalCost || 0).toFixed(4)} (${data.calls || 0} calls)`
          );
          addMessage('system', lines.length > 0 ? `Cost summary:\n${lines.join('\n')}` : 'No cost data yet.');
        } catch { addMessage('system', 'Cost tracking not available yet. Run some workers first.'); }
        return;
      }
      case '/health': {
        try {
          const { createProviderRouter } = await import('../provider-fallback.mjs');
          const router = createProviderRouter();
          const status = router.getStatus();
          const lines = Object.entries(status).map(([p, data]) => {
            const cb = data.circuitBreaker || 'CLOSED';
            const latency = data.p95Latency ? `${data.p95Latency}ms` : '-';
            const icon = cb === 'CLOSED' ? icons.success : cb === 'OPEN' ? icons.failure : icons.warning;
            return `  ${icon} ${PROVIDERS[p]?.name || p}: ${cb} (p95: ${latency}, ${data.successRate || 100}% success)`;
          });
          addMessage('system', lines.length > 0 ? `Provider health:\n${lines.join('\n')}` : 'No health data yet.');
        } catch { addMessage('system', 'Provider health tracking not available yet.'); }
        return;
      }
      case '/logs': {
        if (!args) { addMessage('system', 'Usage: /logs <worker name>'); return; }
        const workers = listWorkers();
        const match = workers.find(w =>
          (w.charter?.name || '').toLowerCase().includes(args.toLowerCase()) || w.id === args
        );
        if (!match) { addMessage('error', `Worker "${args}" not found.`); return; }
        try {
          const runsDir = path.join(os.homedir(), '.nooterra', 'runs');
          const files = fs.readdirSync(runsDir).filter(f => f.endsWith('.json'));
          const receipts = files.map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8')); } catch { return null; }
          }).filter(r => r && r.workerId === match.id).sort((a, b) =>
            (b.completedAt || '').localeCompare(a.completedAt || '')
          ).slice(0, 10);
          if (receipts.length === 0) {
            addMessage('system', `No logs for ${match.charter?.name}. Run it first with /run ${match.charter?.name}`);
          } else {
            const lines = receipts.map(r => {
              const ok = r.success ? icons.success : icons.failure;
              const time = r.completedAt ? new Date(r.completedAt).toLocaleString() : '';
              return `  ${ok} ${time} — ${r.duration || 0}ms, ${r.toolCallCount || 0} tools`;
            });
            addMessage('system', `Logs for ${match.charter?.name} (${receipts.length} runs):\n${lines.join('\n')}`);
          }
        } catch (err) { addMessage('error', `Failed to load logs: ${err.message}`); }
        return;
      }
      case '/delegate': {
        if (!args) {
          addMessage('system', [
            'Delegate a task from one worker to another:',
            '',
            '  /delegate <from-worker> to <to-worker> "<task>"',
            '',
            'Example:',
            '  /delegate "sales lead" to "Price Monitor" "check competitor pricing"',
          ].join('\n'));
          return;
        }
        addMessage('system', 'Delegation engine integration coming soon. Workers can delegate via the __delegate_to_worker tool during execution.');
        return;
      }
      case '/clear': setMessages([]); return;
      case '/quit': case '/exit': case '/q': exit(); return;
      default: addMessage('system', `Unknown: ${cmd}. Type /help.`);
    }
  }, [addMessage, exit, handleRunWorker]);

  // Handle input submission
  const handleSubmit = useCallback(async (input) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    addMessage('user', trimmed);

    if (trimmed.startsWith('/')) { await handleCommand(trimmed); return; }

    // Worker creation conversation
    if (conversation) {
      // Handle instant mode confirmation
      if (conversation._instant) {
        const lower = trimmed.toLowerCase();
        if (/^(y|yes|go|deploy|ship|create|do it|ok)/.test(lower)) {
          const { context, charter, prov, pd } = conversation;
          const worker = createWorker(charter, {
            provider: prov, model: pd.defaultModel,
            triggers: context.schedule?.type !== 'trigger' ? [{
              type: TRIGGER_TYPES.SCHEDULE, config: { schedule: context.schedule }
            }] : []
          });
          addMessage('success', `${worker.charter.name} deployed!`);
          addMessage('system', `Run it: /run ${worker.charter.name}`);
          setConversation(null);
        } else if (/^(edit|change|modify|tweak)/.test(lower)) {
          // Switch to full conversation mode
          const conv = createConversation();
          setConversation(conv);
          const result = processInput(conv, conversation.context.taskDescription);
          addMessage('nooterra', result.message);
        } else {
          addMessage('system', 'Cancelled.');
          setConversation(null);
        }
        return;
      }

      // Regular conversation flow
      const result = processInput(conversation, trimmed);
      addMessage('nooterra', result.message);
      if (conversation.state === CONVERSATION_STATES.COMPLETE || result.deployed) {
        const charter = buildCharterFromContext(conversation.context);
        const prov = conversation.context.provider || getDefaultProvider() || 'chatgpt';
        const pd = PROVIDERS[prov] || PROVIDERS.openai;
        const worker = createWorker(charter, {
          provider: prov, model: pd.defaultModel,
          triggers: conversation.context.schedule ? [{
            type: TRIGGER_TYPES.SCHEDULE, config: { schedule: conversation.context.schedule }
          }] : []
        });
        addMessage('success', `Worker created: ${worker.charter.name}`);
        addMessage('system', `Run it: /run ${worker.charter.name}`);
        setConversation(null);
      }
      return;
    }

    // Detect intent: worker creation request → instant mode, or general chat
    if (looksLikeWorkerRequest(trimmed)) {
      // Instant mode: infer everything from one sentence
      const context = instantCreate(trimmed);
      const charter = buildCharterFromContext(context);
      const prov = getDefaultProvider() || 'chatgpt';
      const pd = PROVIDERS[prov] || PROVIDERS.openai;

      const capNames = (charter.capabilities || []).map(c => c.name || c.id).join(', ');
      addMessage('nooterra',
        `⚡ **${charter.name}**\n` +
        `Purpose: ${charter.purpose}\n` +
        `Tools: ${capNames || 'none'}\n` +
        `Can do: ${charter.canDo.slice(0, 3).join(', ')}\n` +
        `Never do: ${charter.neverDo.slice(0, 2).join(', ')}\n\n` +
        `Say **yes** to deploy, **edit** to customize, or **cancel**.`
      );

      // Store for next input
      setConversation({ _instant: true, context, charter, prov, pd });
    } else {
      // General chat — call the AI
      await handleChat(trimmed);
    }
  }, [addMessage, handleCommand, conversation]);

  // Global keyboard shortcuts
  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
  }, { isActive: view === 'chat' });

  // Max messages to show
  const termHeight = stdout?.rows || 40;
  const maxMessages = Math.max(termHeight - 20, 8);

  return React.createElement(Box, { flexDirection: 'column' },
    // Welcome box (chat view, scrolls up as messages accumulate)
    view === 'chat' && messages.length <= 6
      ? React.createElement(WelcomeBox)
      : null,

    // Main content area
    view === 'onboarding'
      ? React.createElement(OnboardingScreen, { onComplete: handleOnboardingComplete })
      : view === 'workers'
        ? React.createElement(WorkersScreen, {
            onBack: () => setView('chat'),
            onSelect: (w) => { setView('chat'); handleRunWorker(w.charter?.name || w.id); }
          })
        : view === 'dashboard'
          ? React.createElement(DashboardScreen, { onBack: () => setView('chat') })
          : view === 'help'
            ? React.createElement(HelpScreen, { onBack: () => setView('chat') })
            : view === 'receipts'
              ? React.createElement(ReceiptsScreen, { onBack: () => setView('chat') })
              : React.createElement(Box, { flexDirection: 'column' },
                // Messages
                ...messages.slice(-maxMessages).map(msg => renderMessage(msg)),
                // Loading
                loading
                  ? React.createElement(Box, { marginLeft: 1, marginBottom: 1 },
                      React.createElement(Spinner, { label: 'Thinking...' })
                    )
                  : null
              ),

    // Input (only on chat view)
    view === 'chat'
      ? React.createElement(ChatInput, {
          onSubmit: handleSubmit,
          showPalette: false,
          paletteFilter: '/',
        })
      : null,

    // Status bar for sub-screens
    view !== 'chat' && view !== 'onboarding'
      ? React.createElement(StatusBar, { view })
      : null,
  );
}
