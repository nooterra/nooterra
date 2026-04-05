/**
 * EmployeeDashboard — the main screen for a Collections Specialist.
 *
 * Receives { summary } from EmployeeShell's render-prop.
 * Shows status, attention callout, performance cards, and recent activity.
 * No charts. Honest zeros. Freshness note is the honest promise.
 */

import { ArrowRight, Clock, AlertCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(value) {
  if (!value) return 'never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Convert snake_case / dot-separated event types to readable strings.
 * e.g. "communicate.email.sent" → "Email sent"
 *      "invoice.reminder_queued" → "Invoice reminder queued"
 */
function formatEventType(raw) {
  if (!raw) return 'Action';
  const last = raw.split('.').pop() || raw;
  return last
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 px-4 py-4">
      <p className="text-2xs text-text-tertiary uppercase tracking-wider mb-2">{label}</p>
      <p className="text-2xl font-semibold text-text-primary tabular-nums">{value}</p>
      {sub && <p className="text-2xs text-text-tertiary mt-1">{sub}</p>}
    </div>
  );
}

function AttentionBox({ count }) {
  if (!count || count <= 0) return null;
  return (
    <a
      href="/employee/approvals"
      onClick={(e) => {
        e.preventDefault();
        window.history.pushState({}, '', '/employee/approvals');
        // trigger popstate so EmployeeShell can pick it up
        window.dispatchEvent(new PopStateEvent('popstate'));
      }}
      className="flex items-center justify-between rounded-lg border border-blue-600/30 bg-blue-600/10 px-4 py-3 hover:bg-blue-600/15 hover:border-blue-600/50 transition-all duration-150 group"
    >
      <div className="flex items-center gap-2.5">
        <AlertCircle size={15} className="text-blue-400 flex-shrink-0" />
        <span className="text-sm text-blue-300 font-medium">
          {count} {count === 1 ? 'action needs' : 'actions need'} your approval
        </span>
      </div>
      <ArrowRight size={14} className="text-blue-400 group-hover:translate-x-0.5 transition-transform duration-150" />
    </a>
  );
}

function ActivityTimeline({ actions }) {
  if (!actions || actions.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-surface-1 px-4 py-6 text-center">
        <Clock size={16} className="mx-auto text-text-tertiary mb-2" />
        <p className="text-sm text-text-primary">No recent activity</p>
        <p className="text-xs text-text-secondary mt-1">
          Actions taken by the agent will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-edge bg-surface-1 divide-y divide-edge-subtle">
      {actions.map((entry, idx) => {
        const refs = Array.isArray(entry.objectRefs) ? entry.objectRefs : [];
        const firstRef = refs[0];
        return (
          <div key={entry.id || idx} className="flex items-start gap-3 px-4 py-3">
            {/* Timeline dot */}
            <div className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent mt-2" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-text-primary">
                  {formatEventType(entry.eventType)}
                </span>
                <span className="text-2xs text-text-tertiary">
                  {formatDate(entry.timestamp)}
                </span>
              </div>
              {entry.description && (
                <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
                  {entry.description}
                </p>
              )}
            </div>
            {firstRef && (
              <a
                href={`/employee/accounts/${firstRef.objectId || firstRef}`}
                className="flex-shrink-0 flex items-center gap-1 text-2xs text-accent hover:text-blue-300 transition-colors"
              >
                View account
                <ArrowRight size={11} />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EmployeeDashboard({ summary }) {
  if (!summary) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-edge border-t-accent animate-spin" />
          <span className="text-sm text-text-secondary">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  const {
    employeeName,
    overdueCount = 0,
    approvalQueueDepth = 0,
    autonomyCoverage,
    lastSync,
    recentActions = [],
  } = summary;

  const autonomyDisplay = autonomyCoverage != null
    ? `${Math.round(Number(autonomyCoverage) * 100)}%`
    : '—';

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">

        {/* ── Status bar ── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">
              {employeeName || 'Collections Specialist'}
            </h1>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              Collections Specialist · Checks for new Stripe activity every few hours · Last sync:{' '}
              <span className="font-mono">{formatDate(lastSync)}</span>
            </p>
          </div>
          <span className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium text-status-healthy px-2.5 py-1 rounded-full bg-status-healthy/10 border border-status-healthy/20">
            <span className="w-1.5 h-1.5 rounded-full bg-status-healthy inline-block" />
            Active
          </span>
        </div>

        {/* ── Attention needed ── */}
        <AttentionBox count={approvalQueueDepth} />

        {/* ── Performance cards ── */}
        <div>
          <p className="text-2xs text-text-tertiary uppercase tracking-wider mb-3">Performance</p>
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Overdue invoices"
              value={overdueCount}
              sub="requiring follow-up"
            />
            <StatCard
              label="Awaiting approval"
              value={approvalQueueDepth}
              sub="actions in queue"
            />
            <StatCard
              label="Autonomy"
              value={autonomyDisplay}
              sub="actions auto-resolved"
            />
          </div>
        </div>

        {/* ── Recent activity ── */}
        <div>
          <p className="text-2xs text-text-tertiary uppercase tracking-wider mb-3">Recent activity</p>
          <ActivityTimeline actions={recentActions} />
        </div>

      </div>
    </div>
  );
}
