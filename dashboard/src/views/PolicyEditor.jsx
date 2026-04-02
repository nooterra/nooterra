/**
 * Policy Editor — write policies in natural language, see compiled guards.
 *
 * Left: policy list organized by domain.
 * Center: natural language editor with live guard compilation preview.
 * Right: impact analysis — how this policy would affect historical actions.
 *
 * The key UX insight: policies feel like delegating to a trusted employee,
 * not writing code.
 */

import { useState } from 'react';
import {
  Shield, Plus, ChevronRight, Check, X, AlertTriangle,
  Code, Play, FileText, Zap, Lock, Eye,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_POLICIES = [
  {
    id: 'pol_01',
    domain: 'Financial',
    name: 'Collection email authority',
    naturalLanguage: 'Collections agents can send reminder emails to known customers for invoices under $5,000 during business hours (9 AM - 5 PM), using our standard templates. Emails must include our AI disclosure.',
    status: 'active',
    compiledGuards: [
      { type: 'allow', predicate: 'action_class = communicate.email AND counterparty.type = customer AND invoice.amount_cents < 500000' },
      { type: 'require', predicate: 'time.hour >= 9 AND time.hour < 17' },
      { type: 'require', predicate: 'disclosure.present = true' },
    ],
    impactStats: { wouldAllow: 42, wouldBlock: 3, wouldEscrow: 8 },
    lastModified: '3 days ago',
  },
  {
    id: 'pol_02',
    domain: 'Financial',
    name: 'Payment initiation forbidden',
    naturalLanguage: 'No agent may initiate, modify, or approve any outbound payment. All payment actions require human authorization through the approval queue.',
    status: 'active',
    compiledGuards: [
      { type: 'deny', predicate: 'action_class IN (financial.payment.initiate, financial.refund)' },
    ],
    impactStats: { wouldAllow: 0, wouldBlock: 12, wouldEscrow: 0 },
    lastModified: '1 week ago',
  },
  {
    id: 'pol_03',
    domain: 'Communication',
    name: 'Escalation threshold',
    naturalLanguage: 'If a customer mentions "dispute", "incorrect", "wrong charge", or "cancel" in any communication, immediately escalate to human review. Do not send any automated response.',
    status: 'active',
    compiledGuards: [
      { type: 'escalate', predicate: 'conversation.content MATCHES (dispute|incorrect|wrong charge|cancel)' },
      { type: 'deny', predicate: 'action_class = communicate.email WHEN escalation.active = true' },
    ],
    impactStats: { wouldAllow: 0, wouldBlock: 4, wouldEscrow: 4 },
    lastModified: '5 days ago',
  },
  {
    id: 'pol_04',
    domain: 'Operational',
    name: 'Contact frequency limit',
    naturalLanguage: 'Do not contact the same customer more than once per week about the same invoice. If a reminder was sent in the last 7 days for the same invoice, skip it.',
    status: 'active',
    compiledGuards: [
      { type: 'deny', predicate: 'events.count(communicate.email, same_invoice, 7d) >= 1' },
    ],
    impactStats: { wouldAllow: 38, wouldBlock: 14, wouldEscrow: 0 },
    lastModified: '2 days ago',
  },
];

const DOMAINS = ['All', 'Financial', 'Communication', 'Operational', 'Data', 'Agent'];

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function PolicyCard({ policy, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(policy)}
      className={`w-full text-left p-3 rounded-md border transition-colors
        ${selected
          ? 'bg-surface-3 border-accent/30'
          : 'bg-surface-1 border-edge hover:border-edge-strong'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Shield size={12} className={selected ? 'text-accent' : 'text-text-tertiary'} />
            <span className="text-sm font-medium text-text-primary truncate">{policy.name}</span>
          </div>
          <p className="text-xs text-text-secondary mt-1 line-clamp-2">{policy.naturalLanguage}</p>
        </div>
        <span className="flex-shrink-0 text-2xs text-status-healthy bg-status-healthy-muted px-1.5 py-0.5 rounded">
          {policy.status}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2 text-2xs text-text-tertiary">
        <span>{policy.domain}</span>
        <span>{policy.compiledGuards.length} guard{policy.compiledGuards.length !== 1 ? 's' : ''}</span>
        <span>{policy.lastModified}</span>
      </div>
    </button>
  );
}

function CompiledGuard({ guard }) {
  const styles = {
    allow: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', label: 'ALLOW' },
    deny: { bg: 'bg-status-blocked-muted', text: 'text-status-blocked', label: 'DENY' },
    require: { bg: 'bg-status-attention-muted', text: 'text-status-attention', label: 'REQUIRE' },
    escalate: { bg: 'bg-status-predicted-muted', text: 'text-status-predicted', label: 'ESCALATE' },
  };
  const style = styles[guard.type] || styles.require;

  return (
    <div className="flex items-start gap-2 p-2 rounded bg-surface-2">
      <span className={`flex-shrink-0 text-2xs font-mono font-semibold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
        {style.label}
      </span>
      <code className="text-xs text-text-secondary font-mono leading-relaxed break-all">
        {guard.predicate}
      </code>
    </div>
  );
}

function ImpactBar({ label, count, total, color }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-2xs text-text-tertiary w-14 text-right">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs font-mono text-text-secondary w-6 text-right">{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

export default function PolicyEditor() {
  const [domainFilter, setDomainFilter] = useState('All');
  const [selected, setSelected] = useState(MOCK_POLICIES[0]);
  const [editText, setEditText] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const filtered = domainFilter === 'All'
    ? MOCK_POLICIES
    : MOCK_POLICIES.filter(p => p.domain === domainFilter);

  const handleEdit = () => {
    setEditText(selected?.naturalLanguage || '');
    setIsEditing(true);
  };

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Policy list */}
      <div className="w-[340px] flex-shrink-0 border-r border-edge flex flex-col bg-surface-0">
        <div className="p-3 border-b border-edge-subtle">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-text-primary">Policies</h2>
            <button className="flex items-center gap-1 text-2xs text-accent hover:text-accent-hover transition-colors">
              <Plus size={12} /> New
            </button>
          </div>
          <div className="flex items-center gap-0.5 overflow-x-auto">
            {DOMAINS.map(d => (
              <button
                key={d}
                onClick={() => setDomainFilter(d)}
                className={`px-2 py-0.5 rounded text-2xs whitespace-nowrap transition-colors
                  ${domainFilter === d ? 'bg-surface-3 text-text-primary' : 'text-text-tertiary hover:text-text-secondary'}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filtered.map(p => (
            <PolicyCard key={p.id} policy={p} selected={selected?.id === p.id} onSelect={setSelected} />
          ))}
        </div>
      </div>

      {/* Policy detail */}
      {selected && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-lg font-semibold text-text-primary">{selected.name}</h1>
                <div className="flex items-center gap-3 mt-1 text-2xs text-text-tertiary">
                  <span>{selected.domain}</span>
                  <span>Modified {selected.lastModified}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {}}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-text-secondary border border-edge hover:border-edge-strong transition-colors"
                >
                  <Play size={12} /> Test
                </button>
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-white bg-accent hover:bg-accent-hover transition-colors"
                >
                  <FileText size={12} /> Edit
                </button>
              </div>
            </div>

            {/* Natural language policy */}
            <div className="mb-6">
              <div className="flex items-center gap-1.5 mb-2">
                <FileText size={12} className="text-text-tertiary" />
                <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">Policy (natural language)</span>
              </div>
              {isEditing ? (
                <div>
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    className="w-full h-32 p-3 bg-surface-2 border border-edge rounded-md text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
                    placeholder="Describe the policy in plain English..."
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 rounded text-xs bg-accent hover:bg-accent-hover text-white transition-colors">
                      Compile & save
                    </button>
                    <button onClick={() => setIsEditing(false)} className="px-3 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-primary leading-relaxed p-3 rounded-md bg-surface-1 border border-edge">
                  {selected.naturalLanguage}
                </p>
              )}
            </div>

            {/* Compiled guards */}
            <div className="mb-6">
              <div className="flex items-center gap-1.5 mb-2">
                <Code size={12} className="text-text-tertiary" />
                <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">Compiled guards (deterministic)</span>
              </div>
              <div className="space-y-1.5">
                {selected.compiledGuards.map((g, i) => (
                  <CompiledGuard key={i} guard={g} />
                ))}
              </div>
              <p className="text-2xs text-text-tertiary mt-2">
                Guards are deterministic — they run without LLM calls. Fast, predictable, auditable.
              </p>
            </div>

            {/* Impact analysis */}
            <div className="mb-6">
              <div className="flex items-center gap-1.5 mb-2">
                <Eye size={12} className="text-text-tertiary" />
                <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">Impact analysis (last 100 actions)</span>
              </div>
              <div className="p-4 rounded-md bg-surface-1 border border-edge space-y-2">
                <ImpactBar
                  label="Allowed"
                  count={selected.impactStats.wouldAllow}
                  total={selected.impactStats.wouldAllow + selected.impactStats.wouldBlock + selected.impactStats.wouldEscrow}
                  color="bg-status-healthy"
                />
                <ImpactBar
                  label="Blocked"
                  count={selected.impactStats.wouldBlock}
                  total={selected.impactStats.wouldAllow + selected.impactStats.wouldBlock + selected.impactStats.wouldEscrow}
                  color="bg-status-blocked"
                />
                <ImpactBar
                  label="Escrowed"
                  count={selected.impactStats.wouldEscrow}
                  total={selected.impactStats.wouldAllow + selected.impactStats.wouldBlock + selected.impactStats.wouldEscrow}
                  color="bg-status-attention"
                />
              </div>
            </div>

            {/* Conflict detection */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <AlertTriangle size={12} className="text-text-tertiary" />
                <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">Conflicts</span>
              </div>
              <div className="p-3 rounded-md bg-surface-1 border border-edge">
                <div className="flex items-center gap-2">
                  <Check size={14} className="text-status-healthy" />
                  <span className="text-sm text-text-secondary">No conflicts with other active policies.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
