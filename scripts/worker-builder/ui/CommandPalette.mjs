/**
 * CommandPalette — Slash command dropdown
 *
 * Shows filtered command list when user types /
 * Renders below the input area.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { palette } from './theme.mjs';

const COMMANDS = [
  { name: '/new', desc: 'Create a new worker', category: 'workers' },
  { name: '/workers', desc: 'List and manage workers', category: 'workers' },
  { name: '/run', desc: 'Run a worker now (with live progress)', category: 'workers' },
  { name: '/stop', desc: 'Stop a running worker', category: 'workers' },
  { name: '/delegate', desc: 'Delegate task from one worker to another', category: 'workers' },
  { name: '/dashboard', desc: 'Real-time system dashboard', category: 'info' },
  { name: '/status', desc: 'System status overview', category: 'info' },
  { name: '/receipts', desc: 'View recent receipts', category: 'info' },
  { name: '/logs', desc: 'View execution logs for a worker', category: 'info' },
  { name: '/approvals', desc: 'View and respond to pending approvals', category: 'info' },
  { name: '/schedule', desc: 'Schedule recurring worker runs', category: 'workers' },
  { name: '/cost', desc: 'Provider cost tracking summary', category: 'info' },
  { name: '/health', desc: 'Provider health and circuit breaker status', category: 'info' },
  { name: '/model', desc: 'Change or view AI model', category: 'setup' },
  { name: '/connect', desc: 'Connect a tool (Slack, GitHub, etc)', category: 'setup' },
  { name: '/auth', desc: 'Connect or change AI provider', category: 'setup' },
  { name: '/clear', desc: 'Clear the screen', category: 'util' },
  { name: '/help', desc: 'Show all commands', category: 'util' },
  { name: '/quit', desc: 'Exit Nooterra', category: 'util' },
];

export { COMMANDS };

export default function CommandPalette({ filter = '/', focusIndex = 0 }) {
  const filtered = useMemo(() => {
    if (!filter || filter === '/') return COMMANDS;
    const lower = filter.toLowerCase();
    return COMMANDS.filter(c => c.name.startsWith(lower));
  }, [filter]);

  if (filtered.length === 0) return null;

  return React.createElement(Box, {
    flexDirection: 'column',
    paddingX: 1,
  },
    ...filtered.map((cmd, i) => {
      const isFocused = i === 0; // First match is "focused"
      return React.createElement(Box, { key: cmd.name, gap: 1 },
        React.createElement(Box, { width: 24 },
          React.createElement(Text, {
            color: palette.gold,
          }, `  ${cmd.name}`)
        ),
        React.createElement(Text, {
          color: palette.textDim,
        }, cmd.desc)
      );
    })
  );
}
