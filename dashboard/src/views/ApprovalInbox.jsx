/**
 * ApprovalInbox — pilot-critical screen.
 *
 * Receives { summary, refreshSummary } from EmployeeShell.
 * summary.pendingApprovals is an array of escrowed actions enriched with
 * evidence bundles.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { approveAction, rejectAction } from '../lib/employee-api.js';

// ---------------------------------------------------------------------------
// ApprovalCard
// ---------------------------------------------------------------------------

function ApprovalCard({ action, loading, onApprove, onReject, employeeId }) {
  const [expanded, setExpanded] = useState(true);

  const params = action.parameters || {};
  const evidence = action.evidence || {};
  const isEmail = action.actionClass === 'communicate.email';
  const isEscalation = action.actionClass === 'task.create';

  const title = isEmail
    ? (params.subject || 'Untitled email')
    : (params.title || 'Untitled escalation');

  const confidencePct =
    evidence.uncertaintyDeclared != null
      ? Math.round((1 - Number(evidence.uncertaintyDeclared)) * 100)
      : null;

  const badgeLabel = isEscalation ? 'Escalation' : 'Follow-up';
  const badgeClass = isEscalation
    ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
    : 'bg-blue-500/15 text-blue-400 border border-blue-500/30';

  return (
    <div className="rounded-lg border bg-[#12121a] border-[#1a1a24] overflow-hidden">
      {/* ── Header bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1a1a24]">
        <span
          className={`flex-shrink-0 text-2xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${badgeClass}`}
        >
          {badgeLabel}
        </span>

        <span className="flex-1 min-w-0 text-sm font-medium text-[#e8e9ed] truncate">
          {title}
        </span>

        {action.targetObjectId && (
          <a
            href={`/employees/${employeeId}/accounts/${action.targetObjectId}`}
            className="flex-shrink-0 flex items-center gap-1 text-2xs text-[#8b8fa3] hover:text-[#e8e9ed] transition-colors"
          >
            View account
            <ExternalLink size={11} />
          </a>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-shrink-0 p-0.5 rounded text-[#8b8fa3] hover:text-[#e8e9ed] transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      </div>

      {/* ── Expandable body ── */}
      {expanded && (
        <div className="px-4 py-3 space-y-4">
          {/* Email preview */}
          {isEmail && params.body && (
            <div className="rounded border border-[#1a1a24] bg-[#0e0e16] p-3 space-y-2">
              <div className="flex gap-2 text-xs">
                <span className="text-[#8b8fa3] w-16 flex-shrink-0">To</span>
                <span className="text-[#e8e9ed] font-mono break-all">{params.to || '—'}</span>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="text-[#8b8fa3] w-16 flex-shrink-0">Subject</span>
                <span className="text-[#e8e9ed]">{params.subject || '—'}</span>
              </div>
              <div className="border-t border-[#1a1a24] pt-2">
                <p className="text-xs text-[#8b8fa3] whitespace-pre-wrap leading-relaxed">
                  {params.body}
                </p>
              </div>
            </div>
          )}

          {/* Escalation preview */}
          {isEscalation && (
            <div className="rounded border border-[#1a1a24] bg-[#0e0e16] p-3 space-y-2">
              {params.priority && (
                <div className="flex gap-2 text-xs">
                  <span className="text-[#8b8fa3] w-20 flex-shrink-0">Priority</span>
                  <span className="text-[#e8e9ed] capitalize">{params.priority}</span>
                </div>
              )}
              {params.description && (
                <div className="flex gap-2 text-xs">
                  <span className="text-[#8b8fa3] w-20 flex-shrink-0">Description</span>
                  <span className="text-[#e8e9ed] leading-relaxed">{params.description}</span>
                </div>
              )}
            </div>
          )}

          {/* Evidence bundle */}
          <div className="space-y-2">
            <p className="text-2xs font-semibold uppercase tracking-widest text-[#8b8fa3]">
              Evidence
            </p>

            {Array.isArray(evidence.policyClauses) && evidence.policyClauses.length > 0 && (
              <ul className="space-y-1">
                {evidence.policyClauses.map((clause, i) => (
                  <li key={i} className="flex gap-2 text-xs text-[#8b8fa3]">
                    <span className="text-[#4f8ff7] flex-shrink-0">•</span>
                    <span>{clause}</span>
                  </li>
                ))}
              </ul>
            )}

            {Array.isArray(evidence.factsReliedOn) && evidence.factsReliedOn.length > 0 && (
              <p className="text-xs text-[#8b8fa3]">
                <span className="text-[#e8e9ed]">Based on: </span>
                {evidence.factsReliedOn.join(', ')}
              </p>
            )}

            {confidencePct !== null && (
              <p className="text-xs text-[#8b8fa3]">
                <span className="text-[#e8e9ed]">Confidence: </span>
                {confidencePct}%
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onApprove}
              disabled={loading}
              className="flex-1 py-2 rounded text-xs font-semibold bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing...' : 'Approve'}
            </button>
            <button
              onClick={onReject}
              disabled={loading}
              className="flex-1 py-2 rounded text-xs font-semibold border border-[#1a1a24] text-[#8b8fa3] hover:border-red-500/50 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing...' : 'Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApprovalInbox
// ---------------------------------------------------------------------------

export default function ApprovalInbox({ summary, refreshSummary }) {
  const [actioning, setActioning] = useState(null);
  const [dismissed, setDismissed] = useState(new Set());

  const all = Array.isArray(summary?.pendingApprovals) ? summary.pendingApprovals : [];
  const pending = all.filter((a) => !dismissed.has(a.id));

  // Derive employee ID from the first pending action (best available without
  // a dedicated prop — EmployeeShell can override once it passes employeeId).
  const employeeId = summary?.employeeId || null;

  async function handleApprove(actionId) {
    setActioning(actionId);
    try {
      await approveAction(actionId);
      setDismissed((prev) => new Set([...prev, actionId]));
      refreshSummary?.();
    } finally {
      setActioning(null);
    }
  }

  async function handleReject(actionId) {
    setActioning(actionId);
    try {
      await rejectAction(actionId);
      setDismissed((prev) => new Set([...prev, actionId]));
      refreshSummary?.();
    } finally {
      setActioning(null);
    }
  }

  return (
    <div className="h-full bg-[#0a0a0f] overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-6">
        {/* Count header */}
        <p className="text-sm text-[#8b8fa3] mb-5">
          <span className="text-[#e8e9ed] font-semibold">{pending.length}</span>{' '}
          {pending.length === 1 ? 'action' : 'actions'} awaiting your review
        </p>

        {pending.length === 0 ? (
          <div className="rounded-lg border border-[#1a1a24] bg-[#12121a] px-5 py-8 text-center">
            <p className="text-sm text-[#e8e9ed] font-medium mb-1">No pending approvals.</p>
            <p className="text-xs text-[#8b8fa3]">
              {summary?.employeeName
                ? `${summary.employeeName} is handling everything within current guardrails.`
                : 'The agent is handling everything within current guardrails.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((action) => (
              <ApprovalCard
                key={action.id}
                action={action}
                loading={actioning === action.id}
                onApprove={() => handleApprove(action.id)}
                onReject={() => handleReject(action.id)}
                employeeId={employeeId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
