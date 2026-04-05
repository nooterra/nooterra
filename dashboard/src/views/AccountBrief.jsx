/**
 * AccountBrief — deep-dive view on a single customer/party entity.
 *
 * Props: { objectId, employeeId }
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock, CreditCard, FileText, Zap } from 'lucide-react';
import { getAccountBrief } from '../lib/employee-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(cents) {
  if (cents == null || Number.isNaN(Number(cents))) return '—';
  return `$${(Number(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function isInvoiceOrPayment(obj) {
  const t = (obj?.type || '').toLowerCase();
  return t === 'invoice' || t === 'payment';
}

function isAgentEvent(event) {
  const t = String(event?.type || '');
  return (
    t.startsWith('agent.') ||
    t.startsWith('riley.') ||
    t.startsWith('worker.') ||
    t.startsWith('action.')
  );
}

function getObjectDate(obj) {
  const s = obj?.state || {};
  return s.created || s.date || s.timestamp || obj?.createdAt || null;
}

function getObjectAmount(obj) {
  const s = obj?.state || {};
  return s.amountCents ?? s.amount_cents ?? s.total_cents ?? null;
}

function getObjectStatus(obj) {
  const s = obj?.state || {};
  return (s.status || '').toLowerCase();
}

function getObjectLabel(obj) {
  const s = obj?.state || {};
  return s.number || s.invoiceNumber || s.invoice_number || obj?.id || '';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ title, count, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-edge-subtle">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-text-tertiary">{title}</h2>
        {count != null && (
          <span className="text-2xs font-mono text-text-tertiary">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = String(status || '').toLowerCase();
  const styles =
    s === 'paid'
      ? 'bg-status-healthy-muted text-status-healthy border-status-healthy/20'
      : s === 'open'
      ? 'bg-status-attention-muted text-status-attention border-status-attention/30'
      : 'bg-surface-3 text-text-tertiary border-edge';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-2xs font-semibold uppercase tracking-wider ${styles}`}>
      {s || 'unknown'}
    </span>
  );
}

function PaymentRow({ obj, index }) {
  const type = (obj?.type || '').toLowerCase();
  const isPayment = type === 'payment';
  const Icon = isPayment ? CreditCard : FileText;
  const label = getObjectLabel(obj);
  const amount = getObjectAmount(obj);
  const status = getObjectStatus(obj);
  const date = getObjectDate(obj);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 ${
        index % 2 === 0 ? 'bg-surface-1/40' : ''
      } hover:bg-surface-2 transition-colors`}
    >
      <div className="flex-shrink-0 w-7 h-7 rounded bg-surface-3 flex items-center justify-center">
        <Icon size={13} className="text-text-tertiary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary capitalize">{type}</span>
          {label && (
            <span className="text-2xs font-mono text-text-tertiary truncate">{label}</span>
          )}
        </div>
        {date && (
          <div className="text-2xs text-text-tertiary mt-0.5">{formatTime(date)}</div>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-3">
        {amount != null && (
          <span className="text-sm font-mono text-text-primary tabular-nums">{formatMoney(amount)}</span>
        )}
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

function AgentEventRow({ event, index }) {
  return (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 border-l-2 border-l-status-healthy/40 ${
        index % 2 === 0 ? 'bg-surface-1/40' : ''
      } hover:bg-surface-2 transition-colors`}
    >
      <div className="flex-shrink-0 w-7 h-7 rounded bg-surface-3 flex items-center justify-center mt-0.5">
        <Zap size={13} className="text-status-healthy" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{event.type}</div>
        <div className="flex items-center gap-2 mt-0.5 text-2xs text-text-tertiary">
          <span>{formatRelativeTime(event.timestamp)}</span>
          {event.id && <span className="font-mono opacity-50">{event.id}</span>}
        </div>
      </div>
    </div>
  );
}

function OpenInvoiceRow({ obj, index }) {
  const label = getObjectLabel(obj);
  const amount = getObjectAmount(obj);
  const date = getObjectDate(obj);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 ${
        index % 2 === 0 ? 'bg-surface-1/40' : ''
      } hover:bg-surface-2 transition-colors`}
    >
      <FileText size={13} className="flex-shrink-0 text-status-attention" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-primary font-mono truncate">{label || obj?.id}</div>
        {date && <div className="text-2xs text-text-tertiary mt-0.5">{formatTime(date)}</div>}
      </div>
      {amount != null && (
        <span className="flex-shrink-0 text-sm font-mono text-status-attention tabular-nums">
          {formatMoney(amount)}
        </span>
      )}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="rounded-lg border border-edge bg-surface-1 px-4 py-5 text-center">
      <Clock size={16} className="mx-auto text-text-tertiary mb-2" />
      <p className="text-xs text-text-secondary">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AccountBrief({ objectId, employeeId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!objectId) return;

    let cancelled = false;
    setLoading(true);
    setError('');

    getAccountBrief(objectId)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load account brief.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [objectId]);

  // Derived values
  const object = data?.object || null;
  const state = object?.state || {};
  const related = Array.isArray(data?.related) ? data.related : [];
  const events = Array.isArray(data?.events) ? data.events : [];

  // Account identity
  const displayName = state.name || state.email || objectId;
  const stripeCustomerId = state.stripeCustomerId || state.stripe_customer_id || null;
  const email = state.email || null;

  // Payment history: invoices + payments from related, sorted by date desc, up to 20
  const paymentItems = useMemo(() => {
    const items = related
      .map((r) => r?.object || r)
      .filter(isInvoiceOrPayment);

    items.sort((a, b) => {
      const dA = new Date(getObjectDate(a) || 0).getTime();
      const dB = new Date(getObjectDate(b) || 0).getTime();
      return dB - dA;
    });

    return items.slice(0, 20);
  }, [related]);

  // Riley's activity: agent events
  const agentEvents = useMemo(
    () => events.filter(isAgentEvent),
    [events],
  );

  // Open invoices
  const openInvoices = useMemo(
    () =>
      related
        .map((r) => r?.object || r)
        .filter((obj) => {
          const t = (obj?.type || '').toLowerCase();
          return t === 'invoice' && getObjectStatus(obj) === 'open';
        }),
    [related],
  );

  const backHref = employeeId ? `/employees/${employeeId}` : '/command';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="h-full bg-surface-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-3">
          <div className="skeleton h-4 w-24 rounded" />
          <div className="skeleton h-8 w-64 rounded mt-4" />
          <div className="skeleton h-4 w-48 rounded mt-2" />
          <div className="skeleton h-40 w-full rounded mt-6" />
          <div className="skeleton h-32 w-full rounded mt-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-5 py-6 space-y-8">

        {/* Back link */}
        <a
          href={backHref}
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState({}, '', backHref);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          className="inline-flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <ArrowLeft size={13} />
          Back to dashboard
        </a>

        {/* Error banner */}
        {error && (
          <div className="rounded-lg border border-status-blocked/30 bg-status-blocked-muted px-4 py-3 text-sm text-status-blocked">
            {error}
          </div>
        )}

        {/* Account identity */}
        <div className="rounded-lg border border-edge bg-surface-1 px-5 py-4 space-y-3">
          <h1 className="text-lg font-semibold text-text-primary">{displayName}</h1>
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
            {email && (
              <span className="flex items-center gap-1.5">
                <span className="text-text-tertiary uppercase tracking-wider text-2xs font-semibold">Email</span>
                <span className="font-mono">{email}</span>
              </span>
            )}
            {stripeCustomerId && (
              <span className="flex items-center gap-1.5">
                <span className="text-text-tertiary uppercase tracking-wider text-2xs font-semibold">Stripe</span>
                <span className="font-mono">{stripeCustomerId}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="text-text-tertiary uppercase tracking-wider text-2xs font-semibold">ID</span>
              <span className="font-mono text-text-tertiary">{objectId}</span>
            </span>
          </div>
        </div>

        {/* Open Items (only when there are open invoices) */}
        {openInvoices.length > 0 && (
          <Section title="Open Items" count={`${openInvoices.length} open`}>
            <div className="rounded-lg border border-status-attention/30 overflow-hidden">
              {openInvoices.map((obj, index) => (
                <OpenInvoiceRow key={obj?.id || index} obj={obj} index={index} />
              ))}
            </div>
          </Section>
        )}

        {/* Payment History */}
        <Section title="Payment History" count={paymentItems.length > 0 ? `${paymentItems.length} items` : null}>
          {paymentItems.length === 0 ? (
            <EmptyState message="No invoices or payments found for this account." />
          ) : (
            <div className="rounded-lg border border-edge overflow-hidden">
              {paymentItems.map((obj, index) => (
                <PaymentRow key={obj?.id || index} obj={obj} index={index} />
              ))}
            </div>
          )}
        </Section>

        {/* Riley's Activity */}
        <Section title="Riley's Activity" count={agentEvents.length > 0 ? `${agentEvents.length} actions` : null}>
          {agentEvents.length === 0 ? (
            <EmptyState message="No activity for this account yet." />
          ) : (
            <div className="rounded-lg border border-edge overflow-hidden">
              {agentEvents.map((event, index) => (
                <AgentEventRow key={event?.id || index} event={event} index={index} />
              ))}
            </div>
          )}
        </Section>

      </div>
    </div>
  );
}
