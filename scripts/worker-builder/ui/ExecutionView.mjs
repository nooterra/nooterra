/**
 * Nooterra TUI — Execution View
 *
 * Real-time execution progress display for worker runs.
 * Shows:
 * - Streaming tokens as they arrive
 * - Tool call progress with timing
 * - Charter enforcement decisions
 * - Execution timeline
 * - Final receipt summary
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Spinner } from '@inkjs/ui';

import { palette, icons } from './theme.mjs';

// ── Execution phases ────────────────────────────────────────────────────

const PHASES = {
  INIT: 'init',
  CONNECTING: 'connecting',
  THINKING: 'thinking',
  STREAMING: 'streaming',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  APPROVAL: 'approval',
  COMPLETE: 'complete',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

const PHASE_LABELS = {
  [PHASES.INIT]: 'Initializing...',
  [PHASES.CONNECTING]: 'Connecting MCP tools...',
  [PHASES.THINKING]: 'Thinking...',
  [PHASES.STREAMING]: 'Generating response...',
  [PHASES.TOOL_CALL]: 'Calling tool...',
  [PHASES.TOOL_RESULT]: 'Processing result...',
  [PHASES.APPROVAL]: 'Waiting for approval...',
  [PHASES.COMPLETE]: 'Complete',
  [PHASES.ERROR]: 'Error',
  [PHASES.CANCELLED]: 'Cancelled',
};

// ── Progress Bar ────────────────────────────────────────────────────────

function ProgressBar({ percent, width = 30, label }) {
  const filled = Math.round(width * (percent / 100));
  const empty = width - filled;
  const bar = `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
  const color = percent >= 100 ? palette.success : percent > 50 ? palette.gold : palette.textDim;

  return React.createElement(Box, { gap: 1 },
    React.createElement(Text, { color }, bar),
    React.createElement(Text, { color: palette.textDim }, `${Math.round(percent)}%`),
    label ? React.createElement(Text, { color: palette.textMuted }, label) : null,
  );
}

// ── Timeline Entry ──────────────────────────────────────────────────────

function TimelineEntry({ entry, isLast }) {
  const durationStr = entry.durationMs ? `${entry.durationMs}ms` : '';
  const connector = isLast ? '└' : '├';

  let icon, color;
  switch (entry.type) {
    case 'tool_call':
      icon = icons.arrow; color = palette.gold; break;
    case 'tool_result':
      icon = entry.blocked ? icons.failure : icons.success;
      color = entry.blocked ? palette.error : palette.success; break;
    case 'approval':
      icon = icons.warning; color = palette.warning; break;
    case 'error':
      icon = icons.failure; color = palette.error; break;
    case 'thinking':
      icon = icons.bullet; color = palette.textDim; break;
    default:
      icon = icons.dim; color = palette.textDim;
  }

  return React.createElement(Box, { marginLeft: 2 },
    React.createElement(Text, { color: palette.border }, `  ${connector}─ `),
    React.createElement(Text, { color }, icon),
    React.createElement(Text, null, ' '),
    React.createElement(Box, { width: 28 },
      React.createElement(Text, { color }, (entry.label || entry.type).slice(0, 26))
    ),
    React.createElement(Box, { width: 8 },
      React.createElement(Text, { color: palette.textMuted }, durationStr)
    ),
    entry.detail
      ? React.createElement(Text, { color: palette.textDim }, entry.detail.slice(0, 40))
      : null,
  );
}

// ── Streaming Output ────────────────────────────────────────────────────

function StreamingOutput({ tokens, maxLines = 12 }) {
  const lines = tokens.split('\n');
  const visible = lines.slice(-maxLines);

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 3, marginTop: 1 },
    ...visible.map((line, i) =>
      React.createElement(Text, {
        key: i,
        color: i === visible.length - 1 ? palette.text : palette.textDim,
        wrap: 'truncate-end'
      }, line || ' ')
    )
  );
}

// ── Tool Call Display ───────────────────────────────────────────────────

function ToolCallDisplay({ call }) {
  const argsPreview = call.args
    ? JSON.stringify(call.args).slice(0, 60)
    : '';

  return React.createElement(Box, { marginLeft: 3, flexDirection: 'column' },
    React.createElement(Box, { gap: 1 },
      React.createElement(Text, { color: palette.gold, bold: true }, `${icons.arrow} ${call.name}`),
      call.serverId
        ? React.createElement(Text, { color: palette.textMuted }, `via ${call.serverId}`)
        : null,
    ),
    argsPreview
      ? React.createElement(Text, { color: palette.textDim }, `  ${argsPreview}${argsPreview.length >= 60 ? '...' : ''}`)
      : null,
    call.verdict
      ? React.createElement(Text, {
          color: call.verdict === 'canDo' ? palette.success :
                 call.verdict === 'neverDo' ? palette.error : palette.warning
        }, `  Charter: ${call.verdict}${call.rule ? ` — ${call.rule.slice(0, 40)}` : ''}`)
      : null,
  );
}

// ── Receipt Summary ─────────────────────────────────────────────────────

function ReceiptSummary({ receipt }) {
  if (!receipt) return null;

  const ok = receipt.success;
  const dur = receipt.duration || 0;
  const rounds = receipt.executionLog?.length || 0;
  const tools = receipt.toolCallCount || 0;
  const blocked = receipt.blockedActions?.length || 0;
  const approvals = receipt.approvalsPending?.length || 0;

  return React.createElement(Box, { flexDirection: 'column', marginLeft: 2, marginTop: 1 },
    React.createElement(Box, { gap: 1 },
      React.createElement(Text, { color: ok ? palette.success : palette.error, bold: true },
        `${ok ? icons.success : icons.failure} ${ok ? 'Completed' : 'Failed'}`
      ),
      React.createElement(Text, { color: palette.textDim }, `in ${dur}ms`),
      React.createElement(Text, { color: palette.textMuted }, `(${rounds} round${rounds !== 1 ? 's' : ''}, ${tools} tool call${tools !== 1 ? 's' : ''})`),
    ),
    blocked > 0
      ? React.createElement(Text, { color: palette.error, marginLeft: 1 },
          `  ${icons.failure} ${blocked} action${blocked !== 1 ? 's' : ''} blocked by charter`)
      : null,
    approvals > 0
      ? React.createElement(Text, { color: palette.warning, marginLeft: 1 },
          `  ${icons.warning} ${approvals} approval${approvals !== 1 ? 's' : ''} pending`)
      : null,
    React.createElement(Text, { color: palette.textMuted, marginLeft: 1 },
      `  Receipt: ${receipt.taskId}`
    ),
  );
}

// ── Main Execution View ─────────────────────────────────────────────────

export default function ExecutionView({ workerName, events, onCancel }) {
  const { stdout } = useStdout();
  const [phase, setPhase] = useState(PHASES.INIT);
  const [tokens, setTokens] = useState('');
  const [timeline, setTimeline] = useState([]);
  const [currentTool, setCurrentTool] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [heartbeat, setHeartbeat] = useState(null);
  const [round, setRound] = useState(0);
  const [totalRounds, setTotalRounds] = useState(25);
  const startTime = useRef(Date.now());

  // Process events from the streaming executor
  useEffect(() => {
    if (!events) return;

    const handlers = {
      'execution:start': () => {
        setPhase(PHASES.CONNECTING);
        startTime.current = Date.now();
      },
      'execution:thinking': (data) => {
        setPhase(PHASES.THINKING);
        setRound(data?.round || 0);
      },
      'execution:token': (data) => {
        setPhase(PHASES.STREAMING);
        setTokens(prev => prev + (data?.token || ''));
      },
      'execution:tool_call': (data) => {
        setPhase(PHASES.TOOL_CALL);
        setCurrentTool(data);
        setTimeline(prev => [...prev, {
          type: 'tool_call',
          label: data?.name || 'tool',
          detail: data?.serverId ? `via ${data.serverId}` : '',
          startedAt: Date.now(),
        }]);
      },
      'execution:tool_result': (data) => {
        setPhase(PHASES.TOOL_RESULT);
        setCurrentTool(null);
        setTimeline(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.type === 'tool_call') {
            last.type = 'tool_result';
            last.durationMs = Date.now() - last.startedAt;
            last.blocked = data?.blocked;
            last.detail = data?.blocked ? 'BLOCKED' : data?.preview || '';
          }
          return updated;
        });
      },
      'execution:approval': (data) => {
        setPhase(PHASES.APPROVAL);
        setTimeline(prev => [...prev, {
          type: 'approval',
          label: data?.action || 'approval needed',
          detail: data?.rule || '',
        }]);
      },
      'execution:complete': (data) => {
        setPhase(PHASES.COMPLETE);
        setReceipt(data?.receipt || data);
      },
      'execution:error': (data) => {
        setPhase(PHASES.ERROR);
        setTimeline(prev => [...prev, {
          type: 'error',
          label: data?.message || 'error',
        }]);
      },
      'execution:heartbeat': (data) => {
        setHeartbeat(data);
      },
      'execution:stall_detected': () => {
        setTimeline(prev => [...prev, {
          type: 'error',
          label: 'Stall detected — retrying...',
        }]);
      },
    };

    for (const [event, handler] of Object.entries(handlers)) {
      events.on(event, handler);
    }

    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        events.removeListener(event, handler);
      }
    };
  }, [events]);

  // Cancel support
  useInput((input, key) => {
    if (key.escape && phase !== PHASES.COMPLETE && phase !== PHASES.ERROR) {
      setPhase(PHASES.CANCELLED);
      onCancel?.();
    }
  });

  const elapsed = Math.round((Date.now() - startTime.current) / 1000);
  const isActive = phase !== PHASES.COMPLETE && phase !== PHASES.ERROR && phase !== PHASES.CANCELLED;
  const progressPercent = phase === PHASES.COMPLETE ? 100 : Math.min(95, (round / totalRounds) * 100 + 5);

  return React.createElement(Box, { flexDirection: 'column' },
    // Header
    React.createElement(Box, { marginLeft: 2, marginTop: 1, gap: 1 },
      isActive
        ? React.createElement(Spinner, {})
        : React.createElement(Text, { color: phase === PHASES.COMPLETE ? palette.success : palette.error },
            phase === PHASES.COMPLETE ? icons.success : icons.failure
          ),
      React.createElement(Text, { bold: true }, `Running: ${workerName}`),
      React.createElement(Text, { color: palette.textDim }, `${elapsed}s elapsed`),
      round > 0
        ? React.createElement(Text, { color: palette.textMuted }, `round ${round}`)
        : null,
    ),

    // Progress bar
    isActive
      ? React.createElement(Box, { marginLeft: 3 },
          React.createElement(ProgressBar, {
            percent: progressPercent,
            width: 25,
            label: PHASE_LABELS[phase]
          })
        )
      : null,

    // Current tool call
    currentTool
      ? React.createElement(ToolCallDisplay, { call: currentTool })
      : null,

    // Streaming output
    tokens.length > 0
      ? React.createElement(StreamingOutput, { tokens, maxLines: 10 })
      : null,

    // Timeline
    timeline.length > 0
      ? React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
          React.createElement(Text, { color: palette.textDim, marginLeft: 2 }, 'Timeline:'),
          ...timeline.slice(-8).map((entry, i, arr) =>
            React.createElement(TimelineEntry, {
              key: i,
              entry,
              isLast: i === arr.length - 1
            })
          ),
        )
      : null,

    // Receipt (on completion)
    phase === PHASES.COMPLETE
      ? React.createElement(ReceiptSummary, { receipt })
      : null,

    // Error message
    phase === PHASES.ERROR
      ? React.createElement(Box, { marginLeft: 2, marginTop: 1 },
          React.createElement(Text, { color: palette.error }, `${icons.failure} Execution failed. Check /receipts for details.`)
        )
      : null,

    // Controls hint
    React.createElement(Box, { marginLeft: 2, marginTop: 1 },
      React.createElement(Text, { color: palette.textMuted },
        isActive ? '  Esc to cancel' : '  Press any key to continue'
      )
    ),
  );
}

export { PHASES };
