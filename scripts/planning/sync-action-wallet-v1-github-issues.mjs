#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
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
const syncReportPath = path.join(
  repoRoot,
  'planning',
  'github',
  'action-wallet-v1-synced.json'
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

function fetchMilestones(repo) {
  return ghJson(['api', `repos/${repo}/milestones?state=all&per_page=100`]) || [];
}

function sectionReplace(body, heading, content, nextHeading) {
  const pattern = new RegExp(
    `(${heading}\\n)([\\s\\S]*?)(\\n\\n${nextHeading})`
  );
  if (!pattern.test(body)) {
    throw new Error(`Could not find section ${heading}`);
  }
  return body.replace(pattern, `$1${content}$3`);
}

function insertAfterLine(body, startsWith, insertLine) {
  const lines = body.split('\n');
  const index = lines.findIndex((line) => line.startsWith(startsWith));
  if (index === -1) {
    throw new Error(`Could not find line starting with ${startsWith}`);
  }
  if (lines[index + 1] === insertLine) {
    return body;
  }
  lines.splice(index + 1, 0, insertLine);
  return lines.join('\n');
}

function bulletList(items) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- None';
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
  const published = JSON.parse(await readFile(publishedPath, 'utf8'));

  const publishedByKey = new Map(published.issues.map((issue) => [issue.key, issue]));
  const ticketPayloadByKey = new Map(payload.issues.map((issue) => [issue.key, issue]));
  const payloadKeys = new Set([
    ...payload.epics.map((epic) => epic.key),
    ...payload.issues.map((issue) => issue.key)
  ]);
  const milestonesByTitle = new Map(fetchMilestones(payload.repo).map((milestone) => [milestone.title, milestone]));

  const syncResults = [];

  for (const milestone of payload.milestones || []) {
    const existingMilestone = milestonesByTitle.get(milestone.title);
    if (!existingMilestone) {
      throw new Error(`Missing published milestone ${milestone.title}`);
    }

    ghJson(
      ['api', `repos/${payload.repo}/milestones/${existingMilestone.number}`, '--method', 'PATCH', '--input', '-'],
      JSON.stringify({
        title: milestone.title,
        description: milestone.description
      })
    );

    syncResults.push({
      key: milestone.title,
      kind: 'milestone',
      number: existingMilestone.number,
      bodyUpdated: true
    });
  }

  for (const epic of payload.epics) {
    const publishedEpic = publishedByKey.get(epic.key);
    if (!publishedEpic) {
      throw new Error(`Missing published epic for key ${epic.key}`);
    }

    const childLines = epic.childTickets.map((childKey) => {
      const issue = publishedByKey.get(childKey);
      const payloadIssue = ticketPayloadByKey.get(childKey);
      return `#${issue.number} ${childKey} ${payloadIssue.title.replace(/^\[[^\]]+\]\s*/, '') || payloadIssue.title} (${payloadIssue.sprint})`;
    });

    const updatedBody = sectionReplace(
      epic.body,
      'Child Tickets',
      bulletList(childLines),
      'Out of Scope'
    );

    ghJson(
      ['api', `repos/${payload.repo}/issues/${publishedEpic.number}`, '--method', 'PATCH', '--input', '-'],
      JSON.stringify({
        title: epic.title,
        body: updatedBody,
        labels: epic.labels,
        assignees: ['aidenlippert']
      })
    );

    syncResults.push({
      key: epic.key,
      number: publishedEpic.number,
      kind: 'epic',
      assignee: 'aidenlippert',
      bodyUpdated: true
    });
  }

  for (const issue of payload.issues) {
    const publishedIssue = publishedByKey.get(issue.key);
    const publishedEpic = publishedByKey.get(issue.epicKey);
    if (!publishedIssue || !publishedEpic) {
      throw new Error(`Missing published issue or epic for key ${issue.key}`);
    }

    const dependencyLines = (issue.dependencies || []).map((dependencyKey) => {
      const dependencyIssue = publishedByKey.get(dependencyKey);
      if (!dependencyIssue) {
        throw new Error(`Missing dependency issue for key ${dependencyKey}`);
      }
      return `#${dependencyIssue.number} ${dependencyKey}`;
    });

    let updatedBody = insertAfterLine(
      issue.body,
      'Epic:',
      `Epic Issue: #${publishedEpic.number}`
    );
    updatedBody = sectionReplace(
      updatedBody,
      'Dependencies',
      bulletList(dependencyLines),
      'Rollout / Ops Notes'
    );

    const milestoneNumber = issue.milestone ? milestonesByTitle.get(issue.milestone)?.number ?? null : null;

    ghJson(
      ['api', `repos/${payload.repo}/issues/${publishedIssue.number}`, '--method', 'PATCH', '--input', '-'],
      JSON.stringify({
        title: issue.title,
        body: updatedBody,
        labels: issue.labels,
        milestone: milestoneNumber,
        assignees: ['aidenlippert']
      })
    );

    syncResults.push({
      key: issue.key,
      number: publishedIssue.number,
      kind: 'ticket',
      assignee: 'aidenlippert',
      bodyUpdated: true,
      dependencyCount: dependencyLines.length
    });
  }

  for (const publishedIssue of published.issues) {
    if (payloadKeys.has(publishedIssue.key)) {
      continue;
    }

    ghJson(
      ['api', `repos/${payload.repo}/issues/${publishedIssue.number}`, '--method', 'PATCH', '--input', '-'],
      JSON.stringify({
        state: 'closed'
      })
    );

    syncResults.push({
      key: publishedIssue.key,
      number: publishedIssue.number,
      kind: 'removed',
      bodyUpdated: false,
      closed: true
    });
  }

  const report = {
    syncedAt: nowIso(),
    repo: payload.repo,
    issueCount: syncResults.length,
    assignee: 'aidenlippert',
    results: syncResults
  };

  await writeFile(syncReportPath, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
