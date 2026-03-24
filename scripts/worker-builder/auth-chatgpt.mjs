#!/usr/bin/env node

/**
 * Standalone ChatGPT OAuth login script.
 * Run: node scripts/worker-builder/auth-chatgpt.mjs
 */

import { runChatGPTOAuthFlow, loadOAuthTokens } from './provider-auth.mjs';

console.log('\n\x1b[33m  Connecting to ChatGPT...\x1b[0m\n');
console.log('  A browser window will open. Sign in with your ChatGPT account.');
console.log('  After authorizing, you\'ll be redirected back automatically.\n');
console.log('  \x1b[2mWaiting for authorization (up to 2 minutes)...\x1b[0m\n');

try {
  const tokens = await runChatGPTOAuthFlow();
  console.log('\n\x1b[32m  ✓ Connected to ChatGPT!\x1b[0m');
  console.log('  \x1b[2mToken saved to ~/.nooterra/credentials/chatgpt-oauth.json\x1b[0m');
  console.log('  \x1b[2mYour workers can now use your ChatGPT Pro subscription.\x1b[0m\n');
} catch (err) {
  console.error('\n\x1b[31m  ✗ Authentication failed:\x1b[0m', err.message);
  console.error('  \x1b[2mTry again with: nooterra auth chatgpt\x1b[0m\n');
  process.exit(1);
}
