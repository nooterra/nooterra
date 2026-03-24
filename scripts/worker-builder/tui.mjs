#!/usr/bin/env node

/**
 * Nooterra TUI — Entry Point
 *
 * Renders the full Ink-based terminal interface.
 * No alternate screen — renders inline like Claude Code.
 * Resize is handled automatically by Ink.
 */

import React from 'react';
import { render } from 'ink';
import fs from 'fs';
import path from 'path';
import os from 'os';

import App from './ui/App.mjs';
import { listWorkers, WORKER_STATUS } from './worker-persistence.mjs';

const NOOTERRA_DIR = path.join(os.homedir(), '.nooterra');

// Ensure base directory
fs.mkdirSync(NOOTERRA_DIR, { recursive: true });

// Handle --workers flag (non-interactive, no Ink)
if (process.argv.includes('--workers')) {
  const workers = listWorkers();
  if (workers.length === 0) {
    console.log('No workers yet.');
  } else {
    for (const w of workers) {
      const icon = w.status === WORKER_STATUS.RUNNING ? '●' : '○';
      console.log(`  ${icon} ${w.charter?.name || w.id} (${w.provider || 'no provider'})`);
    }
  }
  process.exit(0);
}

// Render the Ink app
const app = render(React.createElement(App), {
  exitOnCtrlC: false,
  patchConsole: true,
});

app.waitUntilExit().then(() => {
  process.exit(0);
});
