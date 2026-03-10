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

function fetchMilestones(repo) {
  return ghJson(['api', `repos/${repo}/milestones?state=all&per_page=100`]) || [];
}

function fetchIssues(repo) {
  return (
    ghJson([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'all',
      '--limit',
      '1000',
      '--json',
      'number,title,url,state'
    ]) || []
  );
}

function createMilestone(repo, milestone) {
  const payload = {
    title: milestone.title,
    description: milestone.description
  };
  if (milestone.dueOn) {
    payload.due_on = milestone.dueOn;
  }
  return ghJson(
    ['api', `repos/${repo}/milestones`, '--method', 'POST', '--input', '-'],
    JSON.stringify(payload)
  );
}

function createIssue(repo, issue) {
  const payload = {
    title: issue.title,
    body: issue.body,
    labels: issue.labels
  };
  if (issue.milestoneNumber) {
    payload.milestone = issue.milestoneNumber;
  }
  return ghJson(
    ['api', `repos/${repo}/issues`, '--method', 'POST', '--input', '-'],
    JSON.stringify(payload)
  );
}

function issueRecord(item, issue, source) {
  return {
    key: item.key,
    kind: item.kind,
    title: issue.title,
    number: issue.number,
    url: issue.html_url || issue.url,
    state: issue.state,
    source
  };
}

async function main() {
  const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
  const { repo, milestones, epics, issues } = payload;

  await mkdir(path.dirname(publishedPath), { recursive: true });

  gh(['auth', 'status']);

  const milestoneResults = [];
  let existingMilestones = fetchMilestones(repo);
  const milestoneByTitle = new Map(existingMilestones.map((m) => [m.title, m]));

  for (const milestone of milestones) {
    const existing = milestoneByTitle.get(milestone.title);
    if (existing) {
      milestoneResults.push({
        title: milestone.title,
        number: existing.number,
        url: existing.html_url,
        source: 'existing'
      });
      continue;
    }

    const created = createMilestone(repo, milestone);
    milestoneResults.push({
      title: milestone.title,
      number: created.number,
      url: created.html_url,
      source: 'created'
    });
    milestoneByTitle.set(milestone.title, created);
  }

  const issueResults = [];
  const existingIssues = fetchIssues(repo);
  const issueByTitle = new Map(existingIssues.map((issue) => [issue.title, issue]));

  for (const epic of epics) {
    const existing = issueByTitle.get(epic.title);
    if (existing) {
      issueResults.push(issueRecord(epic, existing, 'existing'));
      continue;
    }

    const created = createIssue(repo, epic);
    issueResults.push(issueRecord(epic, created, 'created'));
    issueByTitle.set(epic.title, created);
  }

  for (const issue of issues) {
    const existing = issueByTitle.get(issue.title);
    if (existing) {
      issueResults.push(issueRecord(issue, existing, 'existing'));
      continue;
    }

    const milestone = issue.milestone ? milestoneByTitle.get(issue.milestone) : null;
    const created = createIssue(repo, {
      ...issue,
      milestoneNumber: milestone?.number
    });
    issueResults.push(issueRecord(issue, created, 'created'));
    issueByTitle.set(issue.title, created);
  }

  const report = {
    publishedAt: nowIso(),
    repo,
    sourcePayload: path.relative(repoRoot, payloadPath),
    counts: {
      milestonesRequested: milestones.length,
      milestonesCreated: milestoneResults.filter((item) => item.source === 'created').length,
      milestonesExisting: milestoneResults.filter((item) => item.source === 'existing').length,
      epicsRequested: epics.length,
      ticketsRequested: issues.length,
      issuesCreated: issueResults.filter((item) => item.source === 'created').length,
      issuesExisting: issueResults.filter((item) => item.source === 'existing').length
    },
    milestones: milestoneResults,
    issues: issueResults
  };

  await writeFile(publishedPath, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
