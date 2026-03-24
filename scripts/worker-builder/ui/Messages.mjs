/**
 * Message components for the chat view.
 *
 * User messages: subtle gray background, no "You" label (like Claude Code)
 * Nooterra messages: clean text, no prefix
 * System/success/error: minimal with icons
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { palette, icons } from './theme.mjs';

export function NooterraMessage({ content }) {
  return React.createElement(Box, { marginLeft: 1, marginBottom: 1, flexDirection: 'column' },
    React.createElement(Box, { marginLeft: 1 },
      React.createElement(Text, { wrap: 'wrap' }, content)
    )
  );
}

export function UserMessage({ content }) {
  // Gray background bar — like Claude Code's user messages
  // Ink doesn't support background colors on Box, but we can use
  // inverse text or a bordered box with dim styling
  return React.createElement(Box, {
    marginBottom: 1,
    borderStyle: 'single',
    borderColor: '#2a2e36',
    paddingX: 1,
    paddingY: 0,
    marginLeft: 0,
    marginRight: 0,
  },
    React.createElement(Text, { wrap: 'wrap' }, content)
  );
}

export function SystemMessage({ content }) {
  return React.createElement(Box, { marginLeft: 1, marginBottom: 1 },
    React.createElement(Text, { color: palette.textDim }, content)
  );
}

export function SuccessMessage({ content }) {
  return React.createElement(Box, { marginLeft: 1, marginBottom: 1 },
    React.createElement(Text, { color: palette.success }, `${icons.success} `),
    React.createElement(Text, null, content)
  );
}

export function ErrorMessage({ content }) {
  return React.createElement(Box, { marginLeft: 1, marginBottom: 1 },
    React.createElement(Text, { color: palette.error }, `${icons.failure} `),
    React.createElement(Text, null, content)
  );
}

export function WorkerOutputMessage({ content }) {
  return React.createElement(Box, {
    marginLeft: 2, marginBottom: 1, flexDirection: 'column',
    borderStyle: 'single', borderColor: palette.border, paddingX: 1
  },
    React.createElement(Text, { wrap: 'wrap' }, content)
  );
}

export function renderMessage(msg) {
  switch (msg.role) {
    case 'nooterra': return React.createElement(NooterraMessage, { key: msg.id, content: msg.content });
    case 'user': return React.createElement(UserMessage, { key: msg.id, content: msg.content });
    case 'system': return React.createElement(SystemMessage, { key: msg.id, content: msg.content });
    case 'success': return React.createElement(SuccessMessage, { key: msg.id, content: msg.content });
    case 'error': return React.createElement(ErrorMessage, { key: msg.id, content: msg.content });
    case 'worker-output': return React.createElement(WorkerOutputMessage, { key: msg.id, content: msg.content });
    default: return React.createElement(Box, { key: msg.id, marginLeft: 1 },
      React.createElement(Text, null, msg.content)
    );
  }
}
