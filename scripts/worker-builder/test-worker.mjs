#!/usr/bin/env node

/**
 * nooterra test <worker>
 *
 * Dry-run a worker — shows what it WOULD do without executing.
 * Tools are sandboxed (calls are logged but not executed).
 * Charter enforcement still applies.
 */

import { listWorkers, loadWorker } from './worker-persistence.mjs';
import { PROVIDERS, getDefaultProvider, loadProviderCredential } from './provider-auth.mjs';
import { buildSystemPrompt, classifyAction } from './worker-daemon.mjs';
import { WorkerMemory } from './worker-memory.mjs';

const GOLD = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function main() {
  const nameOrId = process.argv.slice(2).join(' ').trim();

  if (!nameOrId) {
    console.log(`\n  ${BOLD}Usage:${RESET} nooterra test <worker name>\n`);
    console.log(`  ${DIM}Dry-run a worker to see what it would do without executing.${RESET}\n`);
    const workers = listWorkers();
    if (workers.length > 0) {
      console.log(`  ${BOLD}Available workers:${RESET}`);
      for (const w of workers) {
        console.log(`    ${CYAN}●${RESET} ${w.charter?.name || w.id}`);
      }
      console.log('');
    }
    process.exit(0);
  }

  // Find the worker
  const workers = listWorkers();
  const worker = workers.find(w =>
    (w.charter?.name || '').toLowerCase().includes(nameOrId.toLowerCase()) || w.id === nameOrId
  );

  if (!worker) {
    console.error(`\n  ${RED}✗${RESET} Worker "${nameOrId}" not found.\n`);
    process.exit(1);
  }

  const charter = worker.charter;
  const provider = worker.provider || getDefaultProvider();
  const provDef = PROVIDERS[provider] || PROVIDERS.openai;

  console.log(`\n  ${BOLD}${GOLD}Test Run: ${charter.name}${RESET}`);
  console.log(`  ${DIM}Provider: ${provDef.name} (${provDef.defaultModel})${RESET}`);
  console.log(`  ${DIM}Mode: DRY RUN — no actions will be executed${RESET}\n`);

  // Show charter
  console.log(`  ${BOLD}Charter:${RESET}`);
  console.log(`  ${DIM}Purpose: ${charter.purpose}${RESET}`);
  if (charter.canDo?.length) console.log(`  ${GREEN}✓ Can do:${RESET} ${charter.canDo.join(', ')}`);
  if (charter.askFirst?.length) console.log(`  ${GOLD}⚡ Ask first:${RESET} ${charter.askFirst.join(', ')}`);
  if (charter.neverDo?.length) console.log(`  ${RED}✗ Never do:${RESET} ${charter.neverDo.join(', ')}`);
  console.log('');

  // Load memory
  try {
    const mem = new WorkerMemory(worker.id);
    const memory = mem.getAll ? mem.getAll() : (mem.memory || {});
    const keys = Object.keys(memory);
    if (keys.length > 0) {
      console.log(`  ${BOLD}Memory (${keys.length} items):${RESET}`);
      for (const k of keys.slice(0, 5)) {
        console.log(`    ${DIM}${k}: ${JSON.stringify(memory[k]).slice(0, 60)}${RESET}`);
      }
      console.log('');
    }
  } catch {}

  // Get credentials
  let credential;
  try {
    credential = await loadProviderCredential(provider);
  } catch (authErr) {
    console.error(`  ${RED}✗${RESET} ${authErr.message}\n`);
    process.exit(1);
  }
  if (!credential) {
    console.error(`  ${RED}✗${RESET} No credentials for ${provider}. Run /auth.\n`);
    process.exit(1);
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(charter) +
    '\n\nIMPORTANT: This is a DRY RUN. Describe what you WOULD do, step by step, but do NOT actually execute any tools. List each action you would take and explain your reasoning.';

  console.log(`  ${DIM}Calling ${provDef.name}...${RESET}\n`);

  // Call the AI (no tools, just get the plan)
  try {
    const { callProvider } = await import('./worker-daemon.mjs');
    const result = await callProvider(
      provider,
      credential,
      provDef.defaultModel,
      systemPrompt,
      [{ role: 'user', content: `DRY RUN: Execute your purpose: ${charter.purpose}\n\nDescribe step by step what you WOULD do. For each step, note which charter rules apply and whether you'd need approval.` }],
      []
    );

    console.log(`  ${BOLD}${CYAN}Plan:${RESET}\n`);
    const lines = (result.content || 'No plan generated.').split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log('');

    // Analyze the plan against charter
    console.log(`  ${BOLD}Charter Check:${RESET}`);
    const actionWords = result.content.toLowerCase();
    let warnings = 0;
    for (const rule of charter.neverDo || []) {
      if (actionWords.includes(rule.toLowerCase().split(' ').pop())) {
        console.log(`    ${RED}⚠ Plan may violate neverDo: "${rule}"${RESET}`);
        warnings++;
      }
    }
    for (const rule of charter.askFirst || []) {
      if (actionWords.includes(rule.toLowerCase().split(' ').pop())) {
        console.log(`    ${GOLD}⚡ Plan includes askFirst action: "${rule}" — will need approval${RESET}`);
      }
    }
    if (warnings === 0) {
      console.log(`    ${GREEN}✓ Plan looks safe against charter rules.${RESET}`);
    }
    console.log('');

  } catch (err) {
    console.error(`  ${RED}✗${RESET} Test failed: ${err.message}\n`);
    process.exit(1);
  }
}

main();
