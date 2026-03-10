#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const issuesPayloadPath = path.join(
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
const reportPath = path.join(
  repoRoot,
  'planning',
  'github',
  'action-wallet-v1-project.json'
);

const PROJECT_TITLE = 'Launch 1 - Action Wallet';
const PROJECT_DESCRIPTION =
  'Host-first Action Wallet launch train: approvals, grants, evidence, receipts, disputes, and operator recovery.';
const PROJECT_README = `# Launch 1 - Action Wallet

Scope lock:

V1 lets external agent hosts create action intents for buy and cancel/recover flows, send users to Nooterra-hosted approval pages, receive scoped execution grants, submit evidence, finalize runs, issue receipts, and open disputes.

This project is seeded from the in-repo Action Wallet GitHub mirror and contains:

- 12 epic trackers
- 119 ticket issues
- milestones AW-S0 through AW-S6

All issues are assigned to \`aidenlippert\`.
`;

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

function findProjectByTitle(projects, title) {
  return projects.find((project) => project.title === title) || null;
}

async function main() {
  const user = ghJson(['api', 'user']);
  const owner = user.login;
  const published = JSON.parse(await readFile(publishedPath, 'utf8'));
  JSON.parse(await readFile(issuesPayloadPath, 'utf8'));

  const allIssueUrls = published.issues.map((issue) => issue.url);

  const existingProjects =
    ghJson(['project', 'list', '--owner', owner, '--format', 'json']).projects || [];
  let project = findProjectByTitle(existingProjects, PROJECT_TITLE);
  let projectCreated = false;
  let repoLinked = false;
  let repoLinkError = null;

  if (!project) {
    project = ghJson([
      'project',
      'create',
      '--owner',
      owner,
      '--title',
      PROJECT_TITLE,
      '--format',
      'json'
    ]);
    projectCreated = true;
  }

  gh([
    'project',
    'edit',
    String(project.number),
    '--owner',
    owner,
    '--description',
    PROJECT_DESCRIPTION,
    '--readme',
    PROJECT_README
  ]);

  try {
    gh([
      'project',
      'link',
      String(project.number),
      '--owner',
      owner,
      '--repo',
      'nooterra/nooterra'
    ]);
    repoLinked = true;
  } catch (error) {
    repoLinkError = String(error.message || error);
  }

  const existingItems =
    ghJson([
      'project',
      'item-list',
      String(project.number),
      '--owner',
      owner,
      '--limit',
      '500',
      '--format',
      'json'
    ]).items || [];

  const itemUrlSet = new Set(
    existingItems
      .map((item) => item.content?.url)
      .filter(Boolean)
  );

  const results = [];
  for (const url of allIssueUrls) {
    if (itemUrlSet.has(url)) {
      results.push({ url, source: 'existing' });
      continue;
    }
    try {
      gh([
        'project',
        'item-add',
        String(project.number),
        '--owner',
        owner,
        '--url',
        url
      ]);
      itemUrlSet.add(url);
      results.push({ url, source: 'created' });
    } catch (error) {
      const message = String(error.message || error);
      if (message.includes('Content already exists in this project')) {
        itemUrlSet.add(url);
        results.push({ url, source: 'existing' });
        continue;
      }
      throw error;
    }
  }

  const report = {
    projectCreatedAt: new Date().toISOString(),
    owner,
    project: {
      number: project.number,
      id: project.id,
      title: project.title,
      url: project.url
    },
    created: projectCreated,
    repoLinked,
    repoLinkError,
    counts: {
      issuesRequested: allIssueUrls.length,
      itemsCreated: results.filter((item) => item.source === 'created').length,
      itemsExisting: results.filter((item) => item.source === 'existing').length
    },
    items: results
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
