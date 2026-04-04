import { useEffect, useMemo, useState } from 'react';
import {
  Clock, CreditCard, FileText, Link2, MessageSquare, Search, Users, X,
} from 'lucide-react';
import { getObjectHistory, getObjects, getRelated } from '../lib/world-api.js';

const TYPE_LABELS = [
  { key: 'all', label: 'All' },
  { key: 'party', label: 'Customers' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'payment', label: 'Payments' },
  { key: 'conversation', label: 'Conversations' },
];

const TYPE_ICONS = {
  party: Users,
  invoice: FileText,
  payment: CreditCard,
  conversation: MessageSquare,
};

function formatMoneyFromState(key, value) {
  if (typeof value !== 'number') return String(value);
  if (key.toLowerCase().includes('cents')) {
    return `$${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return value.toLocaleString();
}

function formatFieldName(field) {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function formatEventTime(value) {
  if (!value) return 'unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unavailable';
  const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function getObjectTitle(obj) {
  const state = obj?.state || {};
  return state.name || state.number || state.subject || obj.id;
}

function ObjectRow({ obj, selected, onSelect }) {
  const Icon = TYPE_ICONS[obj.type] || FileText;

  return (
    <button
      onClick={() => onSelect(obj)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors rounded-sm ${
        selected ? 'bg-surface-3' : 'hover:bg-surface-2'
      }`}
    >
      <Icon size={14} className="flex-shrink-0 text-text-tertiary" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{getObjectTitle(obj)}</div>
        <span className="text-2xs text-text-tertiary font-mono">{obj.type} · {obj.id}</span>
      </div>
    </button>
  );
}

function EmptyState({ title, detail }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 p-6 text-center">
      <Clock size={18} className="mx-auto text-text-tertiary mb-2" />
      <p className="text-sm text-text-primary">{title}</p>
      <p className="text-xs text-text-secondary mt-1">{detail}</p>
    </div>
  );
}

function DetailPanel({ object, related, history, loading, onClose }) {
  if (!object) return null;
  const Icon = TYPE_ICONS[object.type] || FileText;
  const observedEntries = Object.entries(object.state || {});
  const estimatedEntries = Object.entries(object.estimated || {});

  return (
    <div className="animate-fade-in border-l border-edge bg-surface-1 w-[420px] flex-shrink-0 overflow-y-auto">
      <div className="sticky top-0 bg-surface-1 border-b border-edge-subtle p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">{getObjectTitle(object)}</span>
        </div>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-5">
        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Object</span>
          <p className="text-xs font-mono text-text-secondary mt-1">{object.id}</p>
          <p className="text-xs text-text-tertiary mt-1">{object.type}</p>
        </div>

        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Observed state</span>
          <div className="mt-2 space-y-1.5">
            {observedEntries.length === 0 ? (
              <p className="text-xs text-text-tertiary">No observed fields available.</p>
            ) : observedEntries.map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-3">
                <span className="text-xs text-text-secondary">{formatFieldName(key)}</span>
                <span className="text-xs text-text-primary font-mono text-right break-all">
                  {Array.isArray(value)
                    ? JSON.stringify(value)
                    : value && typeof value === 'object'
                    ? JSON.stringify(value)
                    : formatMoneyFromState(key, value)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <span className="text-2xs text-text-tertiary uppercase tracking-wider">Estimated state</span>
          <div className="mt-2 space-y-1.5">
            {estimatedEntries.length === 0 ? (
              <p className="text-xs text-text-tertiary">No inferred fields available yet.</p>
            ) : estimatedEntries.map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-3">
                <span className="text-xs text-text-secondary">{formatFieldName(key)}</span>
                <span className="text-xs text-status-predicted font-mono text-right break-all">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Link2 size={10} className="text-text-tertiary" />
            <span className="text-2xs text-text-tertiary uppercase tracking-wider">Relationships</span>
          </div>
          {loading ? (
            <p className="text-xs text-text-tertiary">Loading relationships...</p>
          ) : related.length === 0 ? (
            <p className="text-xs text-text-tertiary">No related objects recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {related.map(({ relationship, object: relObj }) => (
                <div key={relationship.id} className="rounded bg-surface-2 px-3 py-2">
                  <div className="text-2xs text-text-tertiary font-mono">{relationship.type}</div>
                  <div className="text-sm text-text-primary mt-1">{getObjectTitle(relObj)}</div>
                  <div className="text-2xs text-text-tertiary mt-1">{relObj.type} · {relObj.id}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Clock size={10} className="text-text-tertiary" />
            <span className="text-2xs text-text-tertiary uppercase tracking-wider">Event ledger</span>
          </div>
          {loading ? (
            <p className="text-xs text-text-tertiary">Loading events...</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-text-tertiary">No events reference this object yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((event) => (
                <div key={event.id} className="rounded bg-surface-2 px-3 py-2">
                  <div className="text-xs text-text-primary">{event.type}</div>
                  <div className="text-2xs text-text-tertiary mt-1">{formatEventTime(event.timestamp)} · {event.id}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CompanyState() {
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [objects, setObjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [related, setRelated] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadObjects() {
      setLoadingList(true);
      try {
        const data = await getObjects({
          type: typeFilter === 'all' ? undefined : typeFilter,
          q: search.trim() || undefined,
          limit: 100,
        });
        if (cancelled) return;
        setObjects(data.objects || []);
        setSelected((current) => {
          if (current && (data.objects || []).some((obj) => obj.id === current.id)) return current;
          return (data.objects || [])[0] || null;
        });
        setError('');
      } catch (err) {
        if (!cancelled) {
          setObjects([]);
          setError(err.message || 'Failed to load company state');
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    }

    loadObjects();
    return () => {
      cancelled = true;
    };
  }, [typeFilter, search]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!selected) {
        setRelated([]);
        setHistory([]);
        return;
      }

      setLoadingDetail(true);
      try {
        const [relatedRows, historyRows] = await Promise.all([
          getRelated(selected.id),
          getObjectHistory(selected.id),
        ]);
        if (cancelled) return;
        setRelated(Array.isArray(relatedRows) ? relatedRows : []);
        setHistory(Array.isArray(historyRows) ? historyRows : []);
      } catch {
        if (!cancelled) {
          setRelated([]);
          setHistory([]);
        }
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    }

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const filteredCountLabel = useMemo(() => `${objects.length} objects`, [objects.length]);

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-edge-subtle px-5 py-4 bg-surface-0">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-text-primary">Object graph explorer</h2>
              <p className="text-xs text-text-secondary mt-1">
                Browse the current company state projected from the event ledger.
              </p>
            </div>
            <div className="text-2xs text-text-tertiary font-mono">{filteredCountLabel}</div>
          </div>

          <div className="mt-4 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search IDs, names, emails, invoice numbers"
                aria-label="Search business objects"
                className="w-full pl-9 pr-3 py-2 rounded border border-edge bg-surface-1 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center gap-1 overflow-x-auto">
              {TYPE_LABELS.map((type) => (
                <button
                  key={type.key}
                  onClick={() => setTypeFilter(type.key)}
                  className={`px-3 py-2 rounded text-xs whitespace-nowrap transition-colors ${
                    typeFilter === type.key ? 'bg-surface-3 text-text-primary' : 'text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <div className="rounded-lg border border-status-blocked/30 bg-status-blocked-muted px-4 py-3 text-sm text-status-blocked">
              {error}
            </div>
          ) : loadingList ? (
            <EmptyState title="Loading company state" detail="Fetching objects from the world model." />
          ) : objects.length === 0 ? (
            <EmptyState
              title="No objects found"
              detail="Connect Stripe in setup or widen the current search filter."
            />
          ) : (
            <div className="space-y-1">
              {objects.map((obj) => (
                <ObjectRow
                  key={obj.id}
                  obj={obj}
                  selected={selected?.id === obj.id}
                  onSelect={setSelected}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <DetailPanel
        object={selected}
        related={related}
        history={history}
        loading={loadingDetail}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
