/**
 * Nooterra TUI Theme
 *
 * Centralized color palette and styling constants.
 * Inspired by Claude Code's dark terminal aesthetic.
 */

// Gold accent palette
export const palette = {
  gold: '#d2b06f',
  goldDim: '#8c7544',
  goldBright: '#f3ddae',

  // Text
  text: '#e8e3d5',
  textDim: '#7b7f87',
  textMuted: '#52555c',

  // Status
  success: '#7dd3a5',
  error: '#f97066',
  warning: '#fbbf24',
  info: '#67c8ff',

  // Borders
  border: '#3c414b',
  borderFocus: '#d2b06f',

  // Backgrounds (for potential future use)
  bg: '#0b0f14',
  bgCard: '#11161e',
  bgHighlight: '#1c2230',
};

// Box-drawing characters
export const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
  cross: '┼',
  separator: '─',
};

// Status indicators
export const icons = {
  nooterra: '⬡',
  running: '●',
  ready: '●',
  error: '✗',
  paused: '⏸',
  success: '✓',
  failure: '✗',
  arrow: '❯',
  bullet: '·',
  warning: '⚡',
};
