/**
 * WelcomeBox — Dramatic welcome screen
 *
 * Inspired by Claude Code's research preview:
 * Big ASCII art, warm accent color, minimal text, dramatic presence.
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { palette, icons } from './theme.mjs';
import { PROVIDERS, getDefaultProvider } from '../provider-auth.mjs';
import { listWorkers, WORKER_STATUS } from '../worker-persistence.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

let VERSION = '0.3.0';
try {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  VERSION = pkg.version || VERSION;
} catch {}
const RUNS_DIR = path.join(os.homedir(), '.nooterra', 'runs');

function countReceipts() {
  try { return fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).length; } catch { return 0; }
}

const el = React.createElement;

// Big dramatic NOOTERRA — block letters
const BANNER = [
  ' \u2588\u2588\u2588\u2557   \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2557',
  ' \u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557',
  ' \u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551',
  ' \u2588\u2588\u2551\u255A\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2554\u2550\u2550\u255D  \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551',
  ' \u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2551\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551',
  ' \u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D \u255A\u2550\u2550\u2550\u2550\u2550\u255D  \u255A\u2550\u2550\u2550\u2550\u2550\u255D    \u255A\u2550\u255D   \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D',
];

export default function WelcomeBox() {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns || 80;

  const provider = getDefaultProvider();
  const provDef = provider ? PROVIDERS[provider] : null;
  const workers = listWorkers();
  const receipts = countReceipts();
  const running = workers.filter(w => w.status === WORKER_STATUS.RUNNING).length;

  // Provider + model string
  const provStr = provider
    ? `${provDef?.name || provider} \u00B7 ${provDef?.defaultModel || ''}`
    : 'No AI connected';

  // Workers summary
  const workerStr = workers.length > 0
    ? `${workers.length} worker${workers.length !== 1 ? 's' : ''}${running > 0 ? ` (${running} running)` : ''}`
    : 'No workers yet';

  return el(Box, { flexDirection: 'column' },
    // Top notice box
    el(Box, { borderStyle: 'round', borderColor: palette.textMuted, paddingX: 1, marginBottom: 1, width: Math.min(52, termWidth - 2) },
      el(Text, { color: palette.gold }, '\u2731 '),
      el(Text, null, 'Welcome to '),
      el(Text, { bold: true }, 'Nooterra'),
      el(Text, null, ` v${VERSION}`),
    ),

    // Big ASCII banner
    ...BANNER.map((line, i) =>
      el(Text, { key: `b${i}`, color: palette.gold }, line)
    ),
    el(Text, null, ''),

    // Clean info lines — like Claude Code's research preview
    el(Box, { marginLeft: 1 },
      el(Text, { bold: true }, `${provStr}.`),
    ),
    el(Text, null, ''),
    el(Box, { marginLeft: 1 },
      el(Text, { color: palette.textDim }, `${workerStr} \u00B7 ${receipts} receipt${receipts !== 1 ? 's' : ''}.`),
    ),
    el(Text, null, ''),
    el(Box, { marginLeft: 1 },
      el(Text, { color: palette.info }, 'Describe any job'),
      el(Text, null, ' to create a worker, or type '),
      el(Text, { bold: true }, '/help'),
      el(Text, null, ' for commands.'),
    ),
    el(Text, null, ''),
  );
}
