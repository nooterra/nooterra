/**
 * Company State — object graph explorer.
 *
 * Master-detail layout. Left: filterable list of objects by type.
 * Right: object detail "baseball card" — state, estimated fields,
 * relationships, recent events.
 *
 * Not a graph visualization (those are useless at scale).
 * A searchable, browsable, keyboard-navigable data explorer.
 */

import { useState, useMemo } from 'react';
import {
  Search, Users, FileText, CreditCard, MessageSquare,
  AlertCircle, ChevronRight, X, ArrowUpRight,
  Clock, Link2, TrendingUp, TrendingDown,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_OBJECTS = [
  {
    id: 'party_01HX9A', type: 'party', name: 'Acme Corp',
    state: { name: 'Acme Corp', type: 'customer', contactInfo: [{ type: 'email', value: 'billing@acme.com', primary: true }], tags: ['enterprise'] },
    estimated: { paymentReliability: 0.85, churnRisk: 0.12, engagementLevel: 0.7 },
    updatedAt: '2m ago', status: 'active',
  },
  {
    id: 'party_01HX7B', type: 'party', name: 'CloudStack Ltd',
    state: { name: 'CloudStack Ltd', type: 'customer', contactInfo: [{ type: 'email', value: 'ap@cloudstack.io', primary: true }], tags: ['mid-market'] },
    estimated: { paymentReliability: 0.62, churnRisk: 0.34, engagementLevel: 0.4 },
    updatedAt: '1h ago', status: 'at-risk',
  },
  {
    id: 'inv_01HX9C', type: 'invoice', name: 'INV-2024-001',
    state: { number: 'INV-2024-001', amountCents: 420000, currency: 'USD', status: 'overdue', partyId: 'party_01HX9A', dueAt: '2024-03-15', amountPaidCents: 0, amountRemainingCents: 420000 },
    estimated: { paymentProbability7d: 0.72, disputeRisk: 0.08 },
    updatedAt: '5m ago', status: 'overdue',
  },
  {
    id: 'inv_01HX7D', type: 'invoice', name: 'INV-2024-002',
    state: { number: 'INV-2024-002', amountCents: 1280000, currency: 'USD', status: 'overdue', partyId: 'party_01HX7B', dueAt: '2024-03-01', amountPaidCents: 0, amountRemainingCents: 1280000 },
    estimated: { paymentProbability7d: 0.34, disputeRisk: 0.45 },
    updatedAt: '12m ago', status: 'critical',
  },
  {
    id: 'inv_01HX5E', type: 'invoice', name: 'INV-2024-003',
    state: { number: 'INV-2024-003', amountCents: 75000, currency: 'USD', status: 'paid', partyId: 'party_01HX9A', dueAt: '2024-02-28', amountPaidCents: 75000, amountRemainingCents: 0 },
    estimated: { paymentProbability7d: 1.0, disputeRisk: 0.0 },
    updatedAt: '3d ago', status: 'healthy',
  },
  {
    id: 'pay_01HX6F', type: 'payment', name: 'PAY-$750.00',
    state: { amountCents: 75000, currency: 'USD', status: 'completed', payerPartyId: 'party_01HX9A', method: 'card', paidAt: '2024-02-25' },
    estimated: {},
    updatedAt: '5d ago', status: 'healthy',
  },
  {
    id: 'conv_01HX8G', type: 'conversation', name: 'RE: Invoice #001',
    state: { subject: 'RE: Invoice INV-2024-001', channel: 'email', messageCount: 4, status: 'active', participantPartyIds: ['party_01HX9A'] },
    estimated: { urgency: 0.6, sentiment: -0.1, responseNeeded: true },
    updatedAt: '30m ago', status: 'active',
  },
];

const MOCK_EVENTS = [
  { id: 'evt_1', type: 'financial.invoice.overdue', time: '5m ago', detail: 'Invoice became overdue' },
  { id: 'evt_2', type: 'communication.email.received', time: '30m ago', detail: 'Customer replied about payment timing' },
  { id: 'evt_3', type: 'agent.action.executed', time: '2h ago', detail: 'Collections agent sent friendly reminder' },
  { id: 'evt_4', type: 'financial.invoice.created', time: '15d ago', detail: 'Invoice created from Stripe' },
];

const MOCK_RELATIONSHIPS = [
  { type: 'customer_of', targetName: 'Acme Corp', targetId: 'party_01HX9A', targetType: 'party' },
  { type: 'about', targetName: 'RE: Invoice #001', targetId: 'conv_01HX8G', targetType: 'conversation' },
];

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const TYPE_ICONS = {
  party: Users,
  invoice: FileText,
  payment: CreditCard,
  conversation: MessageSquare,
  obligation: AlertCircle,
};

const STATUS_STYLES = {
  active: 'bg-status-info-muted text-accent',
  healthy: 'bg-status-healthy-muted text-status-healthy',
  'at-risk': 'bg-status-attention-muted text-status-attention',
  overdue: 'bg-status-attention-muted text-status-attention',
  critical: 'bg-status-blocked-muted text-status-blocked',
  paid: 'bg-status-healthy-muted text-status-healthy',
};

function ObjectRow({ obj, selected, onSelect }) {
  const Icon = TYPE_ICONS[obj.type] || FileText;

  return (
    <button
      onClick={() => onSelect(obj)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors rounded-sm
        ${selected ? 'bg-surface-3' : 'hover:bg-surface-2'}`}
    >
      <Icon size={14} className="flex-shrink-0 text-text-tertiary" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary truncate">{obj.name}</span>
          <span className={`flex-shrink-0 text-2xs px-1.5 py-0.5 rounded font-medium ${STATUS_STYLES[obj.status] || ''}`}>
            {obj.status}
          </span>
        </div>
        <span className="text-2xs text-text-tertiary font-mono">{obj.id}</span>
      </div>
      <span className="text-2xs text-text-tertiary flex-shrink-0">{obj.updatedAt}</span>
    </button>
  );
}

function EstimatedField({ field, value }) {
  if (typeof value !== 'number') return null;
  const pct = (value * 100).toFixed(0);
  const isGood = field.includes('Reliability') || field.includes('engag') || field.includes('Probability');
  const color = isGood
    ? (value > 0.7 ? 'text-status-healthy' : value > 0.4 ? 'text-status-attention' : 'text-status-blocked')
    : (value < 0.2 ? 'text-status-healthy' : value < 0.5 ? 'text-status-attention' : 'text-status-blocked');

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-text-secondary">{formatFieldName(field)}</span>
      <div className="flex items-center gap-2">
        <div className="w-16 h-1 bg-surface-3 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${
            color === 'text-status-healthy' ? 'bg-status-healthy' :
            color === 'text-status-attention' ? 'bg-status-attention' : 'bg-status-blocked'
          }`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`text-xs font-mono font-medium w-8 text-right ${color}`}>{pct}%</span>
      </div>
    </div>
  );
}

function formatFieldName(field) {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/(\d+)d$/, ' ($1d)')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

function formatStateValue(key, value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && key.toLowerCase().includes('cents')) {
    return `$${(value / 100).toFixed(2)}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (typeof value[0] === 'object') return `${value.length} items`;
    return value.join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

function DetailPanel({ obj, onClose }) {
  if (!obj) return null;
  const Icon = TYPE_ICONS[obj.type] || FileText;

  return (
    <div className="animate-fade-in border-l border-edge bg-surface-1 w-[420px] flex-shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-surface-1 border-b border-edge-subtle p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">{obj.name}</span>
          <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${STATUS_STYLES[obj.status] || ''}`}>
            {obj.status}
          </span>
        </div>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Object ID */}
        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">ID</span>
          <p className="text-xs font-mono text-text-secondary mt-0.5">{obj.id}</p>
        </div>

        {/* State fields */}
        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Observed State</span>
          <div className="mt-2 space-y-1.5">
            {Object.entries(obj.state).map(([key, value]) => {
              const formatted = formatStateValue(key, value);
              if (!formatted) return null;
              return (
                <div key={key} className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-text-secondary flex-shrink-0">{formatFieldName(key)}</span>
                  <span className="text-xs text-text-primary font-mono text-right truncate">{formatted}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Estimated fields */}
        {Object.keys(obj.estimated).length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-2xs text-text-tertiary uppercase tracking-wider">Estimated</span>
              <span className="text-2xs text-status-predicted font-mono">(inferred)</span>
            </div>
            <div className="space-y-0.5">
              {Object.entries(obj.estimated).map(([field, value]) => (
                <EstimatedField key={field} field={field} value={value} />
              ))}
            </div>
          </div>
        )}

        {/* Relationships */}
        {obj.type === 'invoice' && (
          <div>
            <span className="text-2xs text-text-tertiary uppercase tracking-wider">Relationships</span>
            <div className="mt-2 space-y-1">
              {MOCK_RELATIONSHIPS.map((rel, i) => (
                <button key={i} className="w-full flex items-center gap-2 p-2 rounded bg-surface-2 hover:bg-surface-3 transition-colors text-left group">
                  <Link2 size={10} className="text-text-tertiary" />
                  <span className="text-2xs text-text-tertiary font-mono">{rel.type}</span>
                  <span className="text-xs text-text-primary flex-1 truncate">{rel.targetName}</span>
                  <ArrowUpRight size={10} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent events */}
        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Recent Events</span>
          <div className="mt-2 space-y-1">
            {MOCK_EVENTS.map(evt => (
              <div key={evt.id} className="flex items-start gap-2 py-1.5">
                <Clock size={10} className="flex-shrink-0 mt-1 text-text-tertiary" />
                <div className="min-w-0">
                  <p className="text-xs text-text-primary truncate">{evt.detail}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xs text-text-tertiary">{evt.time}</span>
                    <span className="text-2xs text-text-tertiary font-mono">{evt.type}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main View
// ---------------------------------------------------------------------------

const TYPE_FILTERS = [
  { key: 'all', label: 'All', count: 7 },
  { key: 'party', label: 'Customers', count: 2 },
  { key: 'invoice', label: 'Invoices', count: 3 },
  { key: 'payment', label: 'Payments', count: 1 },
  { key: 'conversation', label: 'Conversations', count: 1 },
];

export default function CompanyState() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    let items = MOCK_OBJECTS;
    if (typeFilter !== 'all') items = items.filter(o => o.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.type.includes(q)
      );
    }
    return items;
  }, [search, typeFilter]);

  return (
    <div className="flex h-full">
      {/* Object list */}
      <div className="w-[400px] flex-shrink-0 border-r border-edge flex flex-col bg-surface-0">
        {/* Search */}
        <div className="p-3 border-b border-edge-subtle">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search objects..."
              className="w-full pl-8 pr-3 py-1.5 bg-surface-2 border border-edge rounded text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20"
            />
          </div>
        </div>

        {/* Type filters */}
        <div className="flex items-center gap-0.5 px-3 py-2 border-b border-edge-subtle overflow-x-auto">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors
                ${typeFilter === f.key ? 'bg-surface-3 text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'}`}
            >
              {f.label}
              <span className="font-mono text-2xs text-text-tertiary">{f.count}</span>
            </button>
          ))}
        </div>

        {/* Object list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map(obj => (
            <ObjectRow
              key={obj.id}
              obj={obj}
              selected={selected?.id === obj.id}
              onSelect={setSelected}
            />
          ))}
          {filtered.length === 0 && (
            <div className="p-6 text-center text-sm text-text-tertiary">
              No objects match your search.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-edge-subtle">
          <span className="text-2xs text-text-tertiary">
            {filtered.length} objects {typeFilter !== 'all' ? `(${typeFilter})` : ''}
          </span>
        </div>
      </div>

      {/* Detail panel or empty state */}
      {selected ? (
        <DetailPanel obj={selected} onClose={() => setSelected(null)} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <FileText size={24} className="mx-auto text-text-tertiary mb-3" />
            <p className="text-sm text-text-secondary">Select an object to view details</p>
            <p className="text-xs text-text-tertiary mt-1">
              Or press <kbd className="px-1 py-0.5 rounded border border-edge text-2xs font-mono">/</kbd> to search
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
