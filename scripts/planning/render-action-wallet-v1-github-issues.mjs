#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const sourceBacklogPath = path.join(
  repoRoot,
  'planning',
  'linear',
  'action-wallet-v1-backlog.json'
);
const outputDir = path.join(repoRoot, 'planning', 'github');
const issuesJsonPath = path.join(outputDir, 'action-wallet-v1-issues.json');
const milestonesJsonPath = path.join(outputDir, 'action-wallet-v1-milestones.json');
const issuesMdPath = path.join(outputDir, 'action-wallet-v1-issues.md');

const REPO = 'nooterra/nooterra';
const PROGRAM = 'Launch 1 - Action Wallet';
const DEFAULT_SCOPE_LOCK =
  'V1 lets external agent hosts create action intents for buy and cancel/recover flows, send users to Nooterra-hosted approval pages, receive scoped execution grants, submit evidence, finalize runs, issue receipts, and open disputes.';

function sprintMilestoneTitle(sprintName) {
  const match = /^Sprint\s+(\d+)$/i.exec(String(sprintName || '').trim());
  if (!match) {
    return null;
  }
  return `AW-S${match[1]}`;
}

const EPIC_STREAM = {
  'ACT-EA': 'stream:protocol',
  'ACT-EB': 'stream:security',
  'ACT-EC': 'stream:protocol',
  'ACT-ED': 'stream:commerce',
  'ACT-EE': 'stream:commerce',
  'ACT-EF': 'stream:protocol',
  'ACT-EG': 'stream:ui',
  'ACT-EH': 'stream:ops',
  'ACT-EI': 'stream:devex',
  'ACT-EK': 'stream:ops',
  'ACT-EL': 'stream:devex'
};

const STREAM_OVERRIDES = {
  'ACT-121': 'stream:ops',
  'ACT-126': 'stream:security',
  'ACT-127': 'stream:security',
  'ACT-128': 'stream:security',
  'ACT-132': 'stream:ui',
  'ACT-133': 'stream:ui',
  'ACT-134': 'stream:ui',
  'ACT-135': 'stream:ops',
  'ACT-136': 'stream:ops',
  'ACT-138': 'stream:ui',
  'ACT-139': 'stream:ops',
  'ACT-140': 'stream:ops'
};

const TYPE_OVERRIDES = {
  'ACT-EA': 'type:epic',
  'ACT-EB': 'type:epic',
  'ACT-EC': 'type:epic',
  'ACT-ED': 'type:epic',
  'ACT-EE': 'type:epic',
  'ACT-EF': 'type:epic',
  'ACT-EG': 'type:epic',
  'ACT-EH': 'type:epic',
  'ACT-EI': 'type:epic',
  'ACT-EK': 'type:epic',
  'ACT-EL': 'type:epic',
  'ACT-001': 'type:protocol',
  'ACT-002': 'type:protocol',
  'ACT-003': 'type:protocol',
  'ACT-004': 'type:protocol',
  'ACT-005': 'type:protocol',
  'ACT-006': 'type:protocol',
  'ACT-007': 'type:protocol',
  'ACT-008': 'type:protocol',
  'ACT-009': 'type:protocol',
  'ACT-020': 'type:protocol',
  'ACT-021': 'type:protocol',
  'ACT-022': 'type:protocol',
  'ACT-023': 'type:protocol',
  'ACT-024': 'type:protocol',
  'ACT-025': 'type:protocol',
  'ACT-026': 'type:protocol',
  'ACT-027': 'type:protocol',
  'ACT-028': 'type:protocol',
  'ACT-029': 'type:protocol',
  'ACT-030': 'type:protocol',
  'ACT-035': 'type:protocol',
  'ACT-060': 'type:protocol',
  'ACT-065': 'type:protocol',
  'ACT-120': 'type:ops',
  'ACT-121': 'type:ops',
  'ACT-122': 'type:ops',
  'ACT-123': 'type:ops',
  'ACT-124': 'type:ops',
  'ACT-125': 'type:ops',
  'ACT-126': 'type:ops',
  'ACT-127': 'type:ops',
  'ACT-128': 'type:ops',
  'ACT-129': 'type:ops',
  'ACT-135': 'type:ops',
  'ACT-136': 'type:ops',
  'ACT-139': 'type:ops',
  'ACT-140': 'type:ops'
};

function priorityLabel(priority) {
  if (priority === 'Highest') return 'prio:p0';
  if (priority === 'High') return 'prio:p1';
  return 'prio:p2';
}

function streamLabel(key, epicKey) {
  return STREAM_OVERRIDES[key] || EPIC_STREAM[epicKey] || 'stream:protocol';
}

function typeLabel(key) {
  return TYPE_OVERRIDES[key] || 'type:feature';
}

function toSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function bulletList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '- None';
  }
  return items.map((item) => `- ${item}`).join('\n');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function renderEpicBody(epic, tickets, scopeLock, outOfScope) {
  const childLines = tickets.map(
    (ticket) => `- ${ticket['Ticket Key']} ${ticket.Title} (${ticket.Sprint})`
  );

  return [
    `Program: ${PROGRAM}`,
    '',
    'Outcome',
    epic.Description,
    '',
    'Scope Lock',
    scopeLock,
    '',
    `Owner Lane: ${epic['Owner Lane']}`,
    `Sprint Coverage: ${Array.isArray(epic['Sprint Coverage']) ? epic['Sprint Coverage'].join(', ') : ''}`,
    '',
    'Child Tickets',
    childLines.join('\n'),
    '',
    'Out of Scope',
    bulletList(outOfScope),
    '',
    'Notes',
    '- This is a tracker issue mirrored from the Action Wallet v1 backlog artifact.',
    '- Tickets retain stable ACT-* keys for cross-reference in PRs and docs.'
  ].join('\n');
}

function renderTicketBody(ticket, epic, sprintConfig) {
  const milestone = sprintConfig[ticket.Sprint]?.milestone || '';
  return [
    `Program: ${PROGRAM}`,
    `Epic: ${epic['Epic Key']} ${epic.Title}`,
    `Sprint: ${ticket.Sprint}${milestone ? ` (${milestone})` : ''}`,
    `Owner Lane: ${ticket['Owner Lane']}`,
    `Area: ${ticket.Area}`,
    `Launch Critical: ${ticket['Launch Critical'] ? 'yes' : 'no'}`,
    `Action Type: ${Array.isArray(ticket['Action Type']) ? ticket['Action Type'].join(', ') : ticket['Action Type']}`,
    `Channel: ${Array.isArray(ticket.Channel) ? ticket.Channel.join(', ') : ticket.Channel}`,
    '',
    'Outcome',
    ticket.Why,
    '',
    'Scope',
    bulletList(ticket.Scope),
    '',
    'Out of Scope',
    bulletList(ticket['Out of Scope']),
    '',
    'Acceptance Criteria',
    bulletList(ticket['Acceptance Criteria']),
    '',
    'Test Plan',
    bulletList(ticket.Tests),
    '',
    'Metrics',
    bulletList(ticket.Metrics),
    '',
    'Dependencies',
    bulletList(ticket.Dependencies),
    '',
    'Rollout / Ops Notes',
    `- State seed: ${ticket.State}`,
    `- Estimate: ${ticket.Estimate}`,
    `- Rollback: ${ticket['Rollback Note']}`
  ].join('\n');
}

function renderMarkdownSummary(milestones, epics, issues, scopeLock) {
  const milestoneSections = milestones.map((milestone) => {
    const sprintIssues = issues.filter((issue) => issue.milestone === milestone.title);
    return [
      `## ${milestone.title} - ${milestone.goal}`,
      '',
      milestone.description,
      '',
      `Issue count: ${sprintIssues.length}`,
      '',
      ...sprintIssues.slice(0, 10).map((issue) => `- ${issue.title}`)
    ].join('\n');
  });

  return [
    `# ${PROGRAM} GitHub Issues Mirror`,
    '',
    `Repo: \`${REPO}\``,
    `Source backlog: \`planning/linear/action-wallet-v1-backlog.json\``,
    '',
    '## Summary',
    '',
    `- Epics: ${epics.length}`,
    `- Ticket issues: ${issues.length}`,
    `- Milestones: ${milestones.length}`,
    `- Scope lock: ${scopeLock}`,
    '',
    '## Label Model',
    '',
    '- One `prio:*` label per issue',
    '- One `stream:*` label per issue',
    '- One `type:*` label per issue',
    '- `program:launch` for program grouping',
    '- `lane:tracker` + `status:tracker-umbrella` for epics',
    '- `lane:active` + `status:missing-gap` for ticket issues',
    '',
    ...milestoneSections
  ].join('\n');
}

function validateBacklog(backlog) {
  if (!backlog || !Array.isArray(backlog.epics) || !Array.isArray(backlog.tickets)) {
    throw new Error('Expected backlog to contain epics and tickets arrays');
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const backlog = JSON.parse(await readFile(sourceBacklogPath, 'utf8'));
  validateBacklog(backlog);
  const scopeLock = backlog.metadata?.scopeLock || DEFAULT_SCOPE_LOCK;
  const outOfScope = Array.isArray(backlog.metadata?.outOfScope)
    ? backlog.metadata.outOfScope
    : [];
  const sprintConfig = Object.fromEntries(
    (backlog.sprints || []).map((sprint) => [
      sprint.Sprint,
      {
        milestone: sprintMilestoneTitle(sprint.Sprint),
        goal: sprint.Goal,
        ship: Array.isArray(sprint.Tickets) ? sprint.Tickets : [],
        exitGate: Array.isArray(sprint['Exit Gate']) ? sprint['Exit Gate'] : []
      }
    ])
  );

  const epicsByKey = new Map(backlog.epics.map((epic) => [epic['Epic Key'], epic]));
  const ticketsByEpic = new Map();
  for (const ticket of backlog.tickets) {
    const list = ticketsByEpic.get(ticket['Epic Key']) || [];
    list.push(ticket);
    ticketsByEpic.set(ticket['Epic Key'], list);
  }

  const milestones = Object.entries(sprintConfig).map(([sprint, config]) => ({
    title: config.milestone,
    sprint,
    goal: config.goal,
    description: `Goal: ${config.goal}. Ship: ${config.ship.join('; ')}. Exit gate: ${config.exitGate.join('; ')}.`,
    dueOn: null
  })).filter((milestone) => milestone.title);

  const epics = backlog.epics.map((epic) => {
    const childTickets = ticketsByEpic.get(epic['Epic Key']) || [];
    const stream = streamLabel(epic['Epic Key'], epic['Epic Key']);
    return {
      kind: 'epic',
      key: epic['Epic Key'],
      title: `[${epic['Epic Key']}] ${epic.Title}`,
      body: renderEpicBody(epic, childTickets, scopeLock, outOfScope),
      labels: [
        priorityLabel(epic.Priority),
        stream,
        typeLabel(epic['Epic Key']),
        'program:launch',
        'lane:tracker',
        'status:tracker-umbrella'
      ],
      milestone: null,
      sprintCoverage: epic['Sprint Coverage'] || [],
      childTickets: childTickets.map((ticket) => ticket['Ticket Key'])
    };
  });

  const issues = backlog.tickets.map((ticket) => {
    const epic = epicsByKey.get(ticket['Epic Key']);
    const stream = streamLabel(ticket['Ticket Key'], ticket['Epic Key']);
    const milestone = sprintConfig[ticket.Sprint]?.milestone || null;
    const labels = unique([
      priorityLabel(ticket.Priority),
      stream,
      typeLabel(ticket['Ticket Key']),
      'program:launch',
      'lane:active',
      'status:missing-gap'
    ]);

    return {
      kind: 'ticket',
      key: ticket['Ticket Key'],
      epicKey: ticket['Epic Key'],
      title: `[${ticket['Ticket Key']}] ${ticket.Title}`,
      body: renderTicketBody(ticket, epic, sprintConfig),
      labels,
      milestone,
      sprint: ticket.Sprint,
      dependencies: ticket.Dependencies,
      ownerLane: ticket['Owner Lane'],
      estimate: ticket.Estimate,
      launchCritical: ticket['Launch Critical'],
      actionType: ticket['Action Type'],
      channel: ticket.Channel
    };
  });

  const payload = {
    repo: REPO,
    program: PROGRAM,
    scopeLock,
    sourceBacklog: 'planning/linear/action-wallet-v1-backlog.json',
    outOfScope,
    milestones,
    epics,
    issues,
    counts: {
      milestones: milestones.length,
      epics: epics.length,
      issues: issues.length
    }
  };

  const markdown = renderMarkdownSummary(milestones, epics, issues, scopeLock);

  await writeFile(issuesJsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await writeFile(milestonesJsonPath, JSON.stringify(milestones, null, 2), 'utf8');
  await writeFile(issuesMdPath, `${markdown}\n`, 'utf8');

  process.stdout.write(
    JSON.stringify(
      {
        sourceBacklogPath,
        issuesJsonPath,
        milestonesJsonPath,
        issuesMdPath,
        counts: payload.counts
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
