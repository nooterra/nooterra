/**
 * Approval Queue — escrowed actions waiting for human decision.
 *
 * Each action card shows: what the agent wants to do, why (evidence bundle),
 * what the world model predicts will happen, the authority chain, and risk factors.
 *
 * Three buttons: Approve, Reject (with reason), Modify.
 * Batch operations for similar actions.
 */

import { useState } from 'react';
import {
  CheckCircle2, XCircle, Edit3, ChevronDown, ChevronRight,
  Mail, Clock, Shield, AlertTriangle, TrendingUp, Eye,
  FileText, User, Link2, Zap,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_ESCROW = [
  {
    id: 'act_01HXA1',
    agentName: 'Collections Agent',
    actionClass: 'communicate.email',
    tool: 'send_collection_email',
    status: 'escrowed',
    createdAt: '12 minutes ago',
    risk: 'low',
    target: {
      type: 'invoice',
      name: 'INV-2024-001',
      detail: '$4,200 — Acme Corp — 18 days overdue',
    },
    parameters: {
      to: 'billing@acme.com',
      subject: 'Friendly reminder: Invoice INV-2024-001 — $4,200.00',
      body: 'Hi Acme Corp team,\n\nI wanted to follow up on Invoice INV-2024-001 for $4,200.00, which was due on March 15. We understand things can slip through — would you be able to process this payment at your earliest convenience?\n\nYou can pay directly here: [payment link]\n\nPlease let us know if you have any questions about this invoice.\n\nBest regards',
      urgency: 'friendly',
    },
    evidence: {
      policyClauses: ['Collection email authority (pol_01)', 'Contact frequency limit (pol_04)'],
      factsReliedOn: ['Invoice 18 days overdue', 'Customer payment reliability: 85%', 'No contact in last 7 days', 'No dispute signals detected'],
      uncertaintyDeclared: 0.12,
      authorityChain: ['Human root grant → Collections Agent grant (communicate.email, <$50K)'],
    },
    prediction: {
      paymentProbability: { current: 0.72, afterAction: 0.85 },
      disputeRisk: { current: 0.08, afterAction: 0.08 },
      recommendation: 'proceed',
    },
  },
  {
    id: 'act_01HXA2',
    agentName: 'Collections Agent',
    actionClass: 'task.create',
    tool: 'create_followup_task',
    status: 'escrowed',
    createdAt: '45 minutes ago',
    risk: 'high',
    target: {
      type: 'invoice',
      name: 'INV-2024-007',
      detail: '$28,500 — TechVentures Inc — 45 days overdue',
    },
    parameters: {
      title: 'ESCALATION: TechVentures Inc — $28,500 overdue, dispute detected',
      description: 'Invoice INV-2024-007 is 45 days overdue. Customer mentioned "incorrect charges" in email on March 20. Dispute risk is 67%. Recommend human review before further automated action.',
      priority: 'critical',
      relatedObjectIds: ['inv_01HX3H', 'party_01HX2I'],
    },
    evidence: {
      policyClauses: ['Escalation threshold (pol_03)', 'Collection email authority — Stage 3 triggers task.create'],
      factsReliedOn: ['Invoice 45 days overdue', 'Customer mentioned "incorrect charges"', 'Dispute risk: 67%', 'Payment probability (7d): 12%'],
      uncertaintyDeclared: 0.35,
      authorityChain: ['Human root grant → Collections Agent grant (task.create requires approval)'],
    },
    prediction: {
      paymentProbability: { current: 0.12, afterAction: 0.12 },
      disputeRisk: { current: 0.67, afterAction: 0.67 },
      recommendation: 'proceed_with_caution',
    },
  },
];

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function RiskBadge({ risk }) {
  const styles = {
    low: 'bg-status-healthy-muted text-status-healthy',
    medium: 'bg-status-attention-muted text-status-attention',
    high: 'bg-status-blocked-muted text-status-blocked',
  };
  return (
    <span className={`text-2xs font-medium px-1.5 py-0.5 rounded uppercase ${styles[risk]}`}>
      {risk} risk
    </span>
  );
}

function PredictionDelta({ label, current, after }) {
  const delta = after - current;
  const improved = (label.includes('payment') && delta > 0) || (label.includes('dispute') && delta < 0);
  const unchanged = Math.abs(delta) < 0.01;

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-text-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-text-tertiary">{(current * 100).toFixed(0)}%</span>
        {!unchanged && (
          <>
            <ChevronRight size={10} className="text-text-tertiary" />
            <span className={`text-xs font-mono font-medium ${improved ? 'text-status-healthy' : 'text-status-attention'}`}>
              {(after * 100).toFixed(0)}%
            </span>
          </>
        )}
        {unchanged && <span className="text-2xs text-text-tertiary">no change</span>}
      </div>
    </div>
  );
}

function EscrowCard({ action, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false);
  const isEmail = action.actionClass === 'communicate.email';

  return (
    <div className={`rounded-lg border bg-surface-1 transition-colors ${
      action.risk === 'high' ? 'border-status-blocked/30' : 'border-edge'
    }`}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex-shrink-0 w-8 h-8 rounded bg-surface-3 flex items-center justify-center mt-0.5">
              {isEmail ? <Mail size={14} className="text-text-secondary" /> : <FileText size={14} className="text-text-secondary" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text-primary">
                  {isEmail ? 'Send email' : 'Create task'}
                </span>
                <RiskBadge risk={action.risk} />
              </div>
              <p className="text-xs text-text-secondary mt-0.5">{action.target.detail}</p>
              <div className="flex items-center gap-3 mt-1 text-2xs text-text-tertiary">
                <span className="flex items-center gap-1"><Zap size={10} />{action.agentName}</span>
                <span className="flex items-center gap-1"><Clock size={10} />{action.createdAt}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Email preview */}
        {isEmail && action.parameters.body && (
          <div className="mt-3 p-3 rounded bg-surface-0 border border-edge-subtle">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xs text-text-tertiary">To:</span>
              <span className="text-xs text-text-primary font-mono">{action.parameters.to}</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xs text-text-tertiary">Subject:</span>
              <span className="text-xs text-text-primary">{action.parameters.subject}</span>
            </div>
            <div className="border-t border-edge-subtle pt-2">
              <p className="text-xs text-text-secondary whitespace-pre-line leading-relaxed">
                {action.parameters.body}
              </p>
              <p className="text-2xs text-text-tertiary mt-2 italic">
                [AI disclosure will be auto-appended by gateway]
              </p>
            </div>
          </div>
        )}

        {/* Expandable evidence */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-3 text-2xs text-text-tertiary hover:text-text-secondary transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Evidence bundle + prediction
        </button>

        {expanded && (
          <div className="mt-3 space-y-3 animate-fade-in">
            {/* Evidence */}
            <div>
              <span className="text-2xs text-text-tertiary uppercase tracking-wider">Evidence</span>
              <div className="mt-1.5 space-y-1">
                {action.evidence.factsReliedOn.map((fact, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className="text-status-healthy mt-0.5">
                      <CheckCircle2 size={10} />
                    </span>
                    <span className="text-xs text-text-secondary">{fact}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Policy clauses */}
            <div>
              <span className="text-2xs text-text-tertiary uppercase tracking-wider">Policies satisfied</span>
              <div className="mt-1.5 space-y-1">
                {action.evidence.policyClauses.map((clause, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Shield size={10} className="text-accent" />
                    <span className="text-xs text-text-secondary">{clause}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Authority chain */}
            <div>
              <span className="text-2xs text-text-tertiary uppercase tracking-wider">Authority chain</span>
              <p className="text-xs text-text-secondary mt-1 font-mono">{action.evidence.authorityChain[0]}</p>
            </div>

            {/* Uncertainty */}
            <div className="flex items-center gap-2">
              <span className="text-2xs text-text-tertiary">Declared uncertainty:</span>
              <span className="text-xs font-mono text-status-predicted">{(action.evidence.uncertaintyDeclared * 100).toFixed(0)}%</span>
            </div>

            {/* Prediction */}
            <div>
              <span className="text-2xs text-text-tertiary uppercase tracking-wider">Predicted impact</span>
              <div className="mt-1.5 p-2 rounded bg-surface-2">
                <PredictionDelta
                  label="Payment probability (7d)"
                  current={action.prediction.paymentProbability.current}
                  after={action.prediction.paymentProbability.afterAction}
                />
                <PredictionDelta
                  label="Dispute risk"
                  current={action.prediction.disputeRisk.current}
                  after={action.prediction.disputeRisk.afterAction}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-edge-subtle bg-surface-0/50 rounded-b-lg">
        <button
          onClick={() => onApprove(action.id)}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-status-healthy/20 text-status-healthy hover:bg-status-healthy/30 transition-colors"
        >
          <CheckCircle2 size={12} /> Approve
        </button>
        <button
          onClick={() => onReject(action.id)}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-status-blocked/10 text-status-blocked hover:bg-status-blocked/20 transition-colors"
        >
          <XCircle size={12} /> Reject
        </button>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors">
          <Edit3 size={12} /> Modify
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function ApprovalQueue() {
  const [actions, setActions] = useState(MOCK_ESCROW);

  const handleApprove = (id) => {
    setActions(prev => prev.filter(a => a.id !== id));
  };

  const handleReject = (id) => {
    setActions(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-5 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Approval Queue</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {actions.length} action{actions.length !== 1 ? 's' : ''} waiting for your decision.
            </p>
          </div>
          {actions.length > 1 && (
            <button className="text-xs text-accent hover:text-accent-hover transition-colors">
              Batch approve similar
            </button>
          )}
        </div>

        {/* Queue */}
        {actions.length > 0 ? (
          <div className="space-y-4">
            {actions.map(action => (
              <EscrowCard
                key={action.id}
                action={action}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        ) : (
          <div className="py-20 text-center">
            <CheckCircle2 size={32} className="mx-auto text-status-healthy mb-3" />
            <p className="text-sm text-text-primary font-medium">All clear</p>
            <p className="text-xs text-text-secondary mt-1">No actions waiting for approval.</p>
          </div>
        )}

        {/* Policy suggestion */}
        {actions.length > 0 && (
          <div className="mt-8 p-4 rounded-lg bg-surface-2 border border-edge">
            <div className="flex items-start gap-2.5">
              <TrendingUp size={14} className="flex-shrink-0 mt-0.5 text-status-predicted" />
              <div>
                <p className="text-sm text-text-primary font-medium">Pattern detected</p>
                <p className="text-xs text-text-secondary mt-1">
                  You've approved 38 similar email actions for known customers with invoices under $5K.
                  Want to make this autonomous?
                </p>
                <button className="mt-2 text-xs font-medium text-accent hover:text-accent-hover transition-colors">
                  Create autonomy policy <ChevronRight size={10} className="inline" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
