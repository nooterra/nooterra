#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const planningDir = path.join(repoRoot, 'planning', 'linear');
const backlogPath = path.join(planningDir, 'action-wallet-v1-backlog.json');
const epicsCsvPath = path.join(planningDir, 'action-wallet-v1-epics.csv');
const ticketsCsvPath = path.join(planningDir, 'action-wallet-v1-tickets.csv');
const linearImportCsvPath = path.join(
  planningDir,
  'action-wallet-v1-linear-import.csv'
);

const REQUIRED_EPIC_FIELDS = [
  'Epic Key',
  'Title',
  'Description',
  'Owner Lane',
  'Priority'
];

const REQUIRED_TICKET_FIELDS = [
  'Ticket Key',
  'Epic Key',
  'Title',
  'Why',
  'Scope',
  'Out of Scope',
  'Acceptance Criteria',
  'Tests',
  'Metrics',
  'Dependencies',
  'Owner',
  'Owner Lane',
  'Sprint',
  'Priority',
  'Estimate',
  'Area',
  'Launch Critical',
  'Action Type',
  'Channel',
  'State',
  'Rollback Note',
  'Labels'
];

function ensureFields(record, fields, type) {
  for (const field of fields) {
    if (!(field in record)) {
      throw new Error(`${type} is missing required field "${field}"`);
    }
  }
}

function ensureArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`Expected "${fieldName}" to be an array`);
  }
  return value;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvLine(values) {
  return `${values.map(csvEscape).join(',')}\n`;
}

function joinList(value, separator = '; ') {
  if (Array.isArray(value)) {
    return value.join(separator);
  }
  return value == null ? '' : String(value);
}

function renderBulletList(items) {
  return ensureArray(items, 'list')
    .map((item) => `- ${item}`)
    .join('\n');
}

function renderTicketDescription(ticket, epic, meta) {
  const lines = [
    `${meta.project || 'Launch 1 - Action Wallet'} import seed`,
    '',
    `Ticket Key: ${ticket['Ticket Key']}`,
    `Epic: ${epic?.Title || ticket['Epic Key']}`,
    `Owner: ${ticket.Owner}`,
    `Owner Lane: ${ticket['Owner Lane']}`,
    `Sprint: ${ticket.Sprint}`,
    `Area: ${ticket.Area}`,
    `Launch Critical: ${ticket['Launch Critical']}`,
    `Action Type: ${joinList(ticket['Action Type'], ', ')}`,
    `Channel: ${joinList(ticket.Channel, ', ')}`,
    `Dependencies: ${joinList(ticket.Dependencies, ', ') || 'None'}`,
    '',
    'Why',
    ticket.Why,
    '',
    'Scope',
    renderBulletList(ticket.Scope),
    '',
    'Out of Scope',
    renderBulletList(ticket['Out of Scope']),
    '',
    'Acceptance Criteria',
    renderBulletList(ticket['Acceptance Criteria']),
    '',
    'Tests',
    renderBulletList(ticket.Tests),
    '',
    'Metrics',
    renderBulletList(ticket.Metrics),
    '',
    'Rollback Note',
    ticket['Rollback Note']
  ];
  return lines.join('\n');
}

function buildEpicsCsv(epics) {
  const lines = [
    csvLine([
      'Epic Key',
      'Title',
      'Description',
      'Owner',
      'Owner Lane',
      'Sprint Coverage',
      'Priority',
      'Labels'
    ])
  ];
  for (const epic of epics) {
    lines.push(
      csvLine([
        epic['Epic Key'],
        epic.Title,
        epic.Description,
        epic.Owner,
        epic['Owner Lane'],
        joinList(epic['Sprint Coverage'], ', '),
        epic.Priority,
        joinList(epic.Labels, ',')
      ])
    );
  }
  return lines.join('');
}

function buildTicketsCsv(tickets, epicsByKey, meta) {
  const header = [
    'Ticket Key',
    'Epic Key',
    'Title',
    'Description',
    'Owner',
    'Owner Lane',
    'Estimate',
    'Priority',
    'Sprint',
    'State',
    'Area',
    'Launch Critical',
    'Action Type',
    'Channel',
    'Dependencies',
    'Labels',
    'Why',
    'Scope',
    'Out of Scope',
    'Acceptance Criteria',
    'Tests',
    'Metrics',
    'Rollback Note'
  ];
  const lines = [csvLine(header)];
  for (const ticket of tickets) {
    lines.push(
      csvLine([
        ticket['Ticket Key'],
        ticket['Epic Key'],
        ticket.Title,
        renderTicketDescription(ticket, epicsByKey.get(ticket['Epic Key']), meta),
        ticket.Owner,
        ticket['Owner Lane'],
        ticket.Estimate,
        ticket.Priority,
        ticket.Sprint,
        ticket.State,
        ticket.Area,
        ticket['Launch Critical'],
        joinList(ticket['Action Type'], ','),
        joinList(ticket.Channel, ','),
        joinList(ticket.Dependencies, ','),
        joinList(ticket.Labels, ','),
        ticket.Why,
        joinList(ticket.Scope, ' | '),
        joinList(ticket['Out of Scope'], ' | '),
        joinList(ticket['Acceptance Criteria'], ' | '),
        joinList(ticket.Tests, ' | '),
        joinList(ticket.Metrics, ' | '),
        ticket['Rollback Note']
      ])
    );
  }
  return lines.join('');
}

function buildLinearImportCsv(tickets, epicsByKey, meta) {
  const header = [
    'Title',
    'Description',
    'Priority',
    'Status',
    'Assignee',
    'Labels',
    'Estimate'
  ];
  const lines = [csvLine(header)];
  for (const ticket of tickets) {
    const labels = Array.isArray(ticket.Labels)
      ? ticket.Labels
      : String(ticket.Labels || '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
    lines.push(
      csvLine([
        `${ticket['Ticket Key']} ${ticket.Title}`,
        renderTicketDescription(ticket, epicsByKey.get(ticket['Epic Key']), meta),
        ticket.Priority,
        ticket.State,
        '',
        labels.join(','),
        ticket.Estimate
      ])
    );
  }
  return lines.join('');
}

function validate(backlog) {
  if (!backlog || typeof backlog !== 'object') {
    throw new Error('Backlog JSON must be an object');
  }
  if (!Array.isArray(backlog.epics) || backlog.epics.length === 0) {
    throw new Error('Backlog must contain a non-empty "epics" array');
  }
  if (!Array.isArray(backlog.tickets) || backlog.tickets.length === 0) {
    throw new Error('Backlog must contain a non-empty "tickets" array');
  }

  const epicKeys = new Set();
  for (const epic of backlog.epics) {
    ensureFields(epic, REQUIRED_EPIC_FIELDS, 'Epic');
    if (epicKeys.has(epic['Epic Key'])) {
      throw new Error(`Duplicate epic key ${epic['Epic Key']}`);
    }
    epicKeys.add(epic['Epic Key']);
  }

  const ticketKeys = new Set();
  for (const ticket of backlog.tickets) {
    ensureFields(ticket, REQUIRED_TICKET_FIELDS, 'Ticket');
    if (ticketKeys.has(ticket['Ticket Key'])) {
      throw new Error(`Duplicate ticket key ${ticket['Ticket Key']}`);
    }
    ticketKeys.add(ticket['Ticket Key']);
    if (!epicKeys.has(ticket['Epic Key'])) {
      throw new Error(
        `Ticket ${ticket['Ticket Key']} references unknown epic ${ticket['Epic Key']}`
      );
    }
    ensureArray(ticket.Scope, 'Scope');
    ensureArray(ticket['Out of Scope'], 'Out of Scope');
    ensureArray(ticket['Acceptance Criteria'], 'Acceptance Criteria');
    ensureArray(ticket.Tests, 'Tests');
    ensureArray(ticket.Metrics, 'Metrics');
    ensureArray(ticket.Dependencies, 'Dependencies');
    ensureArray(ticket.Labels, 'Labels');
  }
}

function normalizeEpic(epic) {
  const ownerLane = epic['Owner Lane'];
  const owner =
    epic.Owner ||
    (typeof ownerLane === 'string' && ownerLane.includes(' - ')
      ? ownerLane.split(' - ')[0]
      : ownerLane);
  const labels = Array.isArray(epic.Labels)
    ? epic.Labels
    : [
        'launch-1',
        'action-wallet',
        String(epic['Epic Key'] || '').toLowerCase()
      ].filter(Boolean);

  return {
    ...epic,
    Owner: owner,
    Labels: labels
  };
}

async function main() {
  await mkdir(planningDir, { recursive: true });
  const raw = await readFile(backlogPath, 'utf8');
  const backlog = JSON.parse(raw);
  validate(backlog);

  backlog.epics = backlog.epics.map(normalizeEpic);

  const epicsByKey = new Map(
    backlog.epics.map((epic) => [epic['Epic Key'], epic])
  );
  const meta = backlog.meta || {};

  const epicsCsv = buildEpicsCsv(backlog.epics);
  const ticketsCsv = buildTicketsCsv(backlog.tickets, epicsByKey, meta);
  const linearImportCsv = buildLinearImportCsv(backlog.tickets, epicsByKey, meta);

  await writeFile(epicsCsvPath, epicsCsv, 'utf8');
  await writeFile(ticketsCsvPath, ticketsCsv, 'utf8');
  await writeFile(linearImportCsvPath, linearImportCsv, 'utf8');

  process.stdout.write(
    JSON.stringify(
      {
        backlogPath,
        epicsCsvPath,
        ticketsCsvPath,
        linearImportCsvPath,
        epicCount: backlog.epics.length,
        ticketCount: backlog.tickets.length
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
