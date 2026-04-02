/**
 * Command Center — the primary operational view.
 *
 * Not a "dashboard with charts." A live operational view.
 * Three health indicators, curated activity stream, attention queue.
 * Feels like mission control, not a SaaS dashboard.
 */

import { useState, useEffect } from 'react';
import {
  Activity, TrendingUp, AlertTriangle, Shield, ChevronRight,
  Clock, DollarSign, Users, FileText, Mail, CheckCircle2,
  XCircle, Pause, Eye, Zap, BarChart3,
} from 'lucide-react';
import { getWorldStats, getEvents, getCoverageProposals, getEscrowQueue } from '../lib/world-api.js';

// ---------------------------------------------------------------------------
// Status Components
// ---------------------------------------------------------------------------

function HealthIndicator({ label, status, value, trend, detail }) {
  const statusColors = {
    healthy: 'text-status-healthy border-status-healthy/30 bg-status-healthy-muted',
    attention: 'text-status-attention border-status-attention/30 bg-status-attention-muted',
    critical: 'text-status-blocked border-status-blocked/30 bg-status-blocked-muted',
  };

  const dotColors = {
    healthy: 'bg-status-healthy',
    attention: 'bg-status-attention',
    critical: 'bg-status-blocked',
  };

  return (
    <div className={`p-4 rounded-lg border ${statusColors[status]}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</span>
        <span className={`inline-flex h-2 w-2 rounded-full ${dotColors[status]}`} />
      </div>
      <div className="text-2xl font-semibold font-mono">{value}</div>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs opacity-60">{detail}</span>
        <span className="text-xs font-medium">{trend}</span>
      </div>
    </div>
  );
}


function ActivityItem({ type, time, agent, description, status, objectId }) {
  const icons = {
    'action.executed': <Zap size={12} className="text-status-healthy" />,
    'action.blocked': <XCircle size={12} className="text-status-blocked" />,
    'action.escrowed': <Pause size={12} className="text-status-attention" />,
    'prediction': <Eye size={12} className="text-status-predicted" />,
    'autonomy.promoted': <TrendingUp size={12} className="text-status-healthy" />,
    'autonomy.demoted': <AlertTriangle size={12} className="text-status-blocked" />,
  };

  const statusBadges = {
    executed: 'bg-status-healthy-muted text-status-healthy',
    blocked: 'bg-status-blocked-muted text-status-blocked',
    escrowed: 'bg-status-attention-muted text-status-attention',
  };

  return (
    <div className="group flex items-start gap-3 py-2.5 px-3 -mx-3 rounded hover:bg-surface-2 transition-colors cursor-pointer">
      <div className="flex-shrink-0 mt-1 w-5 h-5 rounded flex items-center justify-center bg-surface-3">
        {icons[type] || <Activity size={12} className="text-text-tertiary" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-primary truncate">{description}</span>
          {status && (
            <span className={`flex-shrink-0 text-2xs px-1.5 py-0.5 rounded font-medium ${statusBadges[status] || ''}`}>
              {status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-2xs text-text-tertiary font-mono">{time}</span>
          {agent && <span className="text-2xs text-text-tertiary">{agent}</span>}
          {objectId && (
            <span className="text-2xs text-accent font-mono opacity-0 group-hover:opacity-100 transition-opacity">
              {objectId}
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={14} className="flex-shrink-0 text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
    </div>
  );
}

function AttentionItem({ priority, title, description, action, type }) {
  const priorityColors = {
    high: 'border-l-status-blocked',
    medium: 'border-l-status-attention',
    low: 'border-l-accent',
  };

  const typeIcons = {
    escrow: <Pause size={14} className="text-status-attention" />,
    incident: <AlertTriangle size={14} className="text-status-blocked" />,
    promotion: <TrendingUp size={14} className="text-status-healthy" />,
    policy: <Shield size={14} className="text-status-predicted" />,
  };

  return (
    <div className={`p-3 rounded-lg bg-surface-2 border border-edge border-l-2 ${priorityColors[priority]} hover:border-edge-strong transition-colors cursor-pointer`}>
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 mt-0.5">
          {typeIcons[type] || <Activity size={14} className="text-text-secondary" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary font-medium">{title}</p>
          <p className="text-xs text-text-secondary mt-0.5">{description}</p>
          {action && (
            <button className="mt-2 text-xs font-medium text-accent hover:text-accent-hover transition-colors">
              {action} <ChevronRight size={10} className="inline" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Command Center
// ---------------------------------------------------------------------------

export default function CommandCenter() {
  const [liveStats, setLiveStats] = useState(null);
  const [liveEvents, setLiveEvents] = useState(null);
  const [liveEscrow, setLiveEscrow] = useState(null);

  // Fetch real data, fall back to mock if API unavailable
  useEffect(() => {
    let cancelled = false;
    async function fetchLive() {
      try {
        const [stats, events, escrow] = await Promise.all([
          getWorldStats().catch(() => null),
          getEvents({ limit: 10 }).catch(() => null),
          getEscrowQueue().catch(() => null),
        ]);
        if (!cancelled) {
          if (stats) setLiveStats(stats);
          if (events?.events) setLiveEvents(events.events);
          if (escrow) setLiveEscrow(escrow);
        }
      } catch {}
    }
    fetchLive();
    const interval = setInterval(fetchLive, 10000); // refresh every 10s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Mock data — used when API is unavailable
  const mockActivity = [
    { type: 'action.executed', time: '2m ago', agent: 'Collections Agent', description: 'Sent friendly reminder to Acme Corp — Invoice #1247 ($4,200)', status: 'executed', objectId: 'inv_01HX...' },
    { type: 'prediction', time: '5m ago', description: 'Payment probability for Invoice #1189 dropped to 34% — recommending Stage 2 notice', objectId: 'inv_01HW...' },
    { type: 'action.escrowed', time: '12m ago', agent: 'Collections Agent', description: 'Escalation task for TechVentures Inc — 45 days overdue, dispute detected', status: 'escrowed', objectId: 'inv_01HV...' },
    { type: 'autonomy.promoted', time: '1h ago', description: 'Collections Agent promoted to auto_with_review for email reminders to known customers (<$5K)', status: 'executed' },
    { type: 'action.executed', time: '1h ago', agent: 'Collections Agent', description: 'Sent formal notice to CloudStack Ltd — Invoice #1203 ($12,800)', status: 'executed', objectId: 'inv_01HU...' },
    { type: 'action.blocked', time: '3h ago', agent: 'Collections Agent', description: 'Attempted to send email outside business hours — blocked by time window policy', status: 'blocked' },
  ];

  const mockAttention = [
    { priority: 'high', type: 'escrow', title: 'Escalation pending: TechVentures Inc', description: 'Invoice #1198 — $28,500, 45 days overdue, dispute mentioned in last email. Agent recommends human intervention.', action: 'Review & decide' },
    { priority: 'medium', type: 'promotion', title: 'Autonomy promotion ready', description: 'Collections Agent has 52 executions at 94% procedural score for email reminders to known customers. Recommend: auto_with_review → autonomous.', action: 'Review evidence' },
    { priority: 'low', type: 'policy', title: 'Policy gap detected', description: 'No policy covers follow-up cadence for invoices between $5K-$10K. 8 invoices in this range.', action: 'Create policy' },
  ];

  return (
    <div className="h-full bg-surface-0 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-5 py-6">
        {/* Health indicators — live data when available, mock otherwise */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <HealthIndicator
            label="World Model"
            status="healthy"
            value={liveStats ? liveStats.objectCount.toLocaleString() : '847'}
            detail={liveStats ? `${liveStats.eventCount} events in ledger` : 'Objects tracked across systems'}
            trend={liveStats ? `${liveStats.coverageCells} coverage cells` : '2,341 events ↑'}
          />
          <HealthIndicator
            label="Agent Performance"
            status={liveStats?.autonomousCells > 0 ? 'healthy' : 'attention'}
            value={liveStats ? `${liveStats.totalExecutionsTracked}` : '94.2%'}
            detail={liveStats ? 'Executions tracked' : 'Procedural score (7d)'}
            trend={liveStats ? `${liveStats.autonomousCells} autonomous` : '168 actions ↑'}
          />
          <HealthIndicator
            label="Attention Queue"
            status={liveEscrow?.length > 0 ? 'attention' : 'healthy'}
            value={liveEscrow ? String(liveEscrow.length) : '3'}
            detail={liveEscrow ? 'Actions pending approval' : 'Items awaiting decision'}
            trend={liveEscrow?.length > 0 ? `${liveEscrow.length} in queue` : '1 high priority'}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Activity stream */}
          <div className="lg:col-span-3">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-text-primary">Activity</h2>
              <button className="text-2xs text-text-tertiary hover:text-text-secondary transition-colors">
                View all
              </button>
            </div>
            <div className="space-y-0.5">
              {(liveEvents ?? mockActivity).map((item, i) => (
                <ActivityItem key={i} {...item} />
              ))}
            </div>
          </div>

          {/* Attention queue */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-text-primary">Needs attention</h2>
              <span className="text-2xs font-mono text-status-attention">{mockAttention.length}</span>
            </div>
            <div className="space-y-3">
              {mockAttention.map((item, i) => (
                <AttentionItem key={i} {...item} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Re-export for shell lazy loading
export { CommandCenter };
