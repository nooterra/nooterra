#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const payloadPath = path.join(
  repoRoot,
  'planning',
  'github',
  'action-wallet-v1-issues.json'
);
const publishedPath = path.join(
  repoRoot,
  'planning',
  'github',
  'action-wallet-v1-published.json'
);
const finalizedPath = path.join(
  repoRoot,
  'planning',
  'github',
  'action-wallet-v1-finalized.json'
);

function gh(args, input) {
  return execFileSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    input
  }).trim();
}

function ghJson(args, input) {
  const output = gh(args, input);
  return output ? JSON.parse(output) : null;
}

function replaceSection(body, sectionName, replacementLines, nextSectionName) {
  const pattern = new RegExp(
    `(${sectionName}\\n)([\\s\\S]*?)(\\n\\n${nextSectionName})`
  );
  return body.replace(pattern, `$1${replacementLines.join('\n')}$3`);
}

function ticketRef(key, publishedByKey, payloadByKey) {
  const published = publishedByKey.get(key);
  const payload = payloadByKey.get(key);
  if (!published || !payload) {
    return `- ${key}`;
  }
  return `- #${published.number} ${key} ${payload.title.replace(/^\[[^\]]+\]\s*/, '')}`;
}

function buildEpicBody(epic, publishedByKey, payloadByKey) {
  const childLines = epic.childTickets.map((key) => {
    const payload = payloadByKey.get(key);
    const published = publishedByKey.get(key);
    if (!payload || !published) {
      return `- ${key}`;
    }
    return `- #${published.number} ${key} ${payload.title.replace(/^\[[^\]]+\]\s*/, '')} (${payload.sprint})`;
  });
  return replaceSection(epic.body, 'Child Tickets', childLines, 'Out of Scope');
}

function buildTicketBody(issue, publishedByKey, payloadByKey) {
  const epicPublished = publishedByKey.get(issue.epicKey);
  let body = issue.body;
  if (epicPublished) {
    body = body.replace(
      /^Epic: .+$/m,
      (line) => `${line}\nEpic Issue: #${epicPublished.number}`
    );
  }

  const dependencyLines =
    Array.isArray(issue.dependencies) && issue.dependencies.length > 0
      ? issue.dependencies.map((key) => ticketRef(key, publishedByKey, payloadByKey))
      : ['- None'];

  body = replaceSection(
    body,
    'Dependencies',
    dependencyLines,
    'Rollout / Ops Notes'
  );
  return body;
}

function patchIssue(repo, number, body, assignee) {
  return ghJson(
    ['api', `repos/${repo}/issues/${number}`, '--method', 'PATCH', '--input', '-'],
    JSON.stringify({
      body,
      assignees: [assignee]
    })
  );
}

async function main() {
  const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
  const published = JSON.parse(await readFile(publishedPath, 'utf8'));
  const user = ghJson(['api', 'user']);
  const assignee = user.login;

  const payloadByKey = new Map();
  for (const epic of payload.epics) {
    payloadByKey.set(epic.key, epic);
  }
  for (const issue of payload.issues) {
    payloadByKey.set(issue.key, issue);
  }

  const publishedByKey = new Map(
    published.issues.map((issue) => [issue.key, issue])
  );

  const finalizedIssues = [];

  for (const epic of payload.epics) {
    const publishedIssue = publishedByKey.get(epic.key);
    const body = buildEpicBody(epic, publishedByKey, payloadByKey);
    const updated = patchIssue(payload.repo, publishedIssue.number, body, assignee);
    finalizedIssues.push({
      key: epic.key,
      kind: epic.kind,
      number: updated.number,
      url: updated.html_url,
      assignees: updated.assignees.map((item) => item.login)
    });
  }

  for (const issue of payload.issues) {
    const publishedIssue = publishedByKey.get(issue.key);
    const body = buildTicketBody(issue, publishedByKey, payloadByKey);
    const updated = patchIssue(payload.repo, publishedIssue.number, body, assignee);
    finalizedIssues.push({
      key: issue.key,
      kind: issue.kind,
      number: updated.number,
      url: updated.html_url,
      assignees: updated.assignees.map((item) => item.login)
    });
  }

  const report = {
    finalizedAt: new Date().toISOString(),
    repo: payload.repo,
    assignee,
    counts: {
      issuesTouched: finalizedIssues.length
    },
    issues: finalizedIssues
  };

  await mkdir(path.dirname(finalizedPath), { recursive: true });
  await writeFile(finalizedPath, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
