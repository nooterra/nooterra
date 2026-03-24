/**
 * WorkersScreen — Selectable grid of worker cards
 *
 * Shows all workers in bordered cards with status.
 * Arrow keys to navigate, Enter to select, Esc to go back.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette, icons, box } from './theme.mjs';
import { listWorkers, WORKER_STATUS } from '../worker-persistence.mjs';
import { PROVIDERS } from '../provider-auth.mjs';

function WorkerCard({ worker, isFocused }) {
  const w = worker;
  const isRunning = w.status === WORKER_STATUS.RUNNING;
  const isError = w.status === WORKER_STATUS.ERROR;
  const statusIcon = isRunning ? icons.running : isError ? icons.error : icons.ready;
  const statusColor = isRunning ? palette.success : isError ? palette.error : palette.info;
  const statusLabel = isRunning ? 'running' : isError ? 'error' : 'ready';
  const name = w.charter?.name || w.id;
  const prov = w.provider ? (PROVIDERS[w.provider]?.name || w.provider) : 'no provider';
  const model = w.model || PROVIDERS[w.provider]?.defaultModel || '';
  const runs = w.stats?.totalRuns || 0;
  const purpose = (w.charter?.purpose || '').slice(0, 58);
  const canDo = (w.charter?.canDo || []).slice(0, 3);
  const neverDo = (w.charter?.neverDo || []).slice(0, 2);
  const borderColor = isFocused ? palette.gold : palette.border;

  return React.createElement(Box, {
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor,
    paddingX: 1,
    width: 64,
    marginBottom: 0,
  },
    // Header — name + status
    React.createElement(Box, { justifyContent: 'space-between' },
      React.createElement(Text, { bold: true, color: isFocused ? palette.gold : palette.text }, name),
      React.createElement(Box, { gap: 1 },
        React.createElement(Text, { color: statusColor }, statusIcon),
        React.createElement(Text, { color: statusColor }, statusLabel)
      )
    ),
    // Purpose
    purpose
      ? React.createElement(Text, { color: palette.textDim }, purpose)
      : null,
    // Separator
    React.createElement(Text, { color: palette.border },
      box.horizontal.repeat(60)
    ),
    // Provider + runs
    React.createElement(Box, { gap: 2 },
      React.createElement(Text, { color: palette.textDim }, prov),
      model ? React.createElement(Text, { color: palette.textMuted }, `(${model})`) : null,
      React.createElement(Text, { color: palette.textDim }, `${icons.bullet} ${runs} run${runs !== 1 ? 's' : ''}`),
    ),
    // Rules preview
    canDo.length > 0
      ? React.createElement(Box, null,
          React.createElement(Text, { color: palette.success }, `${icons.success} `),
          React.createElement(Text, { color: palette.textDim },
            canDo.map(r => r.slice(0, 20)).join(`  ${icons.bullet}  `)
          )
        )
      : null,
    neverDo.length > 0
      ? React.createElement(Box, null,
          React.createElement(Text, { color: palette.error }, `${icons.failure} `),
          React.createElement(Text, { color: palette.textDim },
            neverDo.map(r => r.slice(0, 20)).join(`  ${icons.bullet}  `)
          )
        )
      : null,
  );
}

export default function WorkersScreen({ onBack, onSelect }) {
  const workers = listWorkers();
  const [focusIndex, setFocusIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.upArrow) { setFocusIndex(i => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setFocusIndex(i => Math.min(workers.length - 1, i + 1)); return; }
    if (key.return && workers[focusIndex]) { onSelect(workers[focusIndex]); return; }
  });

  if (workers.length === 0) {
    return React.createElement(Box, { flexDirection: 'column', marginLeft: 2, marginTop: 1 },
      React.createElement(Text, { bold: true }, 'Workers'),
      React.createElement(Text, null, ''),
      React.createElement(Text, { color: palette.textDim },
        '  No workers yet. Describe what you need and Nooterra will create one.'
      ),
      React.createElement(Text, null, ''),
      React.createElement(Text, { color: palette.textMuted },
        '  Press Esc to go back'
      ),
    );
  }

  return React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
    // Header
    React.createElement(Box, { marginLeft: 2, marginBottom: 1 },
      React.createElement(Text, { bold: true }, `Workers (${workers.length})`),
    ),
    // Cards
    ...workers.map((w, i) =>
      React.createElement(Box, { key: w.id, marginLeft: 1 },
        React.createElement(WorkerCard, { worker: w, isFocused: i === focusIndex })
      )
    ),
    // Footer
    React.createElement(Box, { marginTop: 1, marginLeft: 2 },
      React.createElement(Text, { color: palette.textMuted },
        '\u2191\u2193 navigate \u00B7 Enter to run \u00B7 Esc to go back'
      )
    ),
  );
}
