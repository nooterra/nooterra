#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const publishedPath = path.join(
  repoRoot,
  'planning',
  'github',
  'action-wallet-v1-published.json'
);
const REPO = 'nooterra/nooterra';

function parseArgs(argv) {
  const options = {
    owner: 'aidenlippert',
    projectTitle: 'Launch 1 - Action Wallet',
    reportPath: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--owner') {
      options.owner = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--project-title') {
      options.projectTitle = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--report') {
      options.reportPath = argv[index + 1];
      index += 1;
    }
  }

  if (!options.reportPath) {
    const slug = options.owner.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    options.reportPath = path.join(
      repoRoot,
      'planning',
      'github',
      `action-wallet-v1-project-${slug}.json`
    );
  } else if (!path.isAbsolute(options.reportPath)) {
    options.reportPath = path.join(repoRoot, options.reportPath);
  }

  return options;
}

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

function nowIso() {
  return new Date().toISOString();
}

function getProject(owner, projectTitle) {
  const projects = ghJson(['project', 'list', '--owner', owner, '--format', 'json'])?.projects || [];
  return projects.find((project) => project.title === projectTitle) || null;
}

function createProject(owner, projectTitle) {
  return ghJson([
    'project',
    'create',
    '--owner',
    owner,
    '--title',
    projectTitle,
    '--format',
    'json'
  ]);
}

function listProjectItems(projectNumber, owner) {
  return (
    ghJson([
      'project',
      'item-list',
      String(projectNumber),
      '--owner',
      owner,
      '--limit',
      '500',
      '--format',
      'json'
    ])?.items || []
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const published = JSON.parse(await readFile(publishedPath, 'utf8'));

  let project = getProject(options.owner, options.projectTitle);
  const projectSource = project ? 'existing' : 'created';
  if (!project) {
    project = createProject(options.owner, options.projectTitle);
  }

  let repoLink = 'linked';
  try {
    gh(['project', 'link', String(project.number), '--owner', options.owner, '--repo', REPO]);
  } catch (error) {
    const message = String(error.message || error);
    if (message.includes('already linked')) {
      repoLink = 'already-linked';
    } else if (message.includes('different owner from')) {
      repoLink = 'skipped-different-owner';
    } else {
      throw error;
    }
  }

  const existingItems = listProjectItems(project.number, options.owner);
  const existingContentNumbers = new Set(
    existingItems
      .map((item) => item.content?.number)
      .filter((value) => typeof value === 'number')
  );

  const addResults = [];
  for (const issue of published.issues) {
    if (existingContentNumbers.has(issue.number)) {
      addResults.push({
        number: issue.number,
        key: issue.key,
        source: 'existing'
      });
      continue;
    }

    try {
      gh([
        'project',
        'item-add',
        String(project.number),
        '--owner',
        options.owner,
        '--url',
        issue.url
      ]);

      addResults.push({
        number: issue.number,
        key: issue.key,
        source: 'added'
      });
    } catch (error) {
      const message = String(error.message || error);
      if (message.includes('Content already exists in this project')) {
        addResults.push({
          number: issue.number,
          key: issue.key,
          source: 'existing'
        });
        continue;
      }
      throw error;
    }
  }

  const report = {
    syncedAt: nowIso(),
    owner: options.owner,
    repo: REPO,
    project: {
      number: project.number,
      title: project.title,
      id: project.id,
      url: project.url,
      source: projectSource,
      repoLink
    },
    counts: {
      requested: published.issues.length,
      added: addResults.filter((item) => item.source === 'added').length,
      existing: addResults.filter((item) => item.source === 'existing').length
    },
    items: addResults
  };

  await writeFile(options.reportPath, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
