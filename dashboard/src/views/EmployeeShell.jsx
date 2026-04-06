/**
 * EmployeeShell — chrome for the employee-facing AR collections experience.
 *
 * Sidebar nav (w-56), top bar, and renders children as a render function
 * receiving { summary, refreshSummary }.
 *
 * Polls getEmployeeSummary(employeeId) on mount and every 30s.
 */

import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, CheckSquare, Settings, Zap } from 'lucide-react';
import { getEmployeeSummary } from '../lib/employee-api.js';

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { key: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard, path: '/employee' },
  { key: 'approvals',  label: 'Approvals',  icon: CheckSquare,     path: '/employee/approvals' },
  { key: 'settings',   label: 'Settings',   icon: Settings,        path: '/employee/settings' },
];

function getActiveKey() {
  if (typeof window === 'undefined') return 'dashboard';
  const path = window.location.pathname;
  const match = NAV_ITEMS.find(n => n.path === path);
  return match ? match.key : 'dashboard';
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export default function EmployeeShell({ employeeId, initialView, children }) {
  const [activeKey, setActiveKey] = useState(initialView || getActiveKey());
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const refreshSummary = useCallback(async () => {
    if (!employeeId) return;
    try {
      const data = await getEmployeeSummary(employeeId);
      setSummary(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message || 'Failed to load employee summary');
    }
  }, [employeeId]);

  // Initial fetch + 30s polling
  useEffect(() => {
    refreshSummary();
    const id = setInterval(refreshSummary, 30_000);
    return () => clearInterval(id);
  }, [refreshSummary]);

  // Sync active key with URL on mount
  useEffect(() => {
    setActiveKey(getActiveKey());
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const onPop = () => setActiveKey(getActiveKey());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (key) => {
    setActiveKey(key);
    const item = NAV_ITEMS.find(n => n.key === key);
    if (item) window.history.pushState({}, '', item.path);
  };

  // Derive badge counts from summary
  const approvalBadge = summary?.approvalQueueDepth > 0
    ? summary.approvalQueueDepth
    : null;

  // Avatar letter from summary name or fallback
  const avatarLetter = summary?.employeeName
    ? summary.employeeName.charAt(0).toUpperCase()
    : 'E';

  return (
    <div className="flex h-screen bg-surface-0 text-text-primary overflow-hidden">
      {/* ─── Sidebar ─── */}
      <aside className="flex-shrink-0 flex flex-col border-r border-edge bg-surface-1 w-56">
        {/* Logo */}
        <div className="h-12 flex items-center px-3.5 border-b border-edge-subtle">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded bg-accent/20 flex items-center justify-center flex-shrink-0">
              <Zap size={12} className="text-accent" />
            </div>
            <span className="text-sm font-semibold tracking-tight truncate">nooterra</span>
          </div>
        </div>

        {/* Employee identity */}
        <div className="px-3 pt-4 pb-3 border-b border-edge-subtle">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-blue-400">
              {avatarLetter}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {summary?.employeeName || '—'}
              </p>
              <p className="text-2xs text-text-tertiary truncate">Collections Specialist</p>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-2 px-2 space-y-0.5">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
            const isActive = activeKey === key;
            const badge = key === 'approvals' ? approvalBadge : null;
            return (
              <button
                key={key}
                onClick={() => navigate(key)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded transition-all duration-150 text-left group relative
                  ${isActive
                    ? 'bg-surface-3 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
                  }`}
              >
                {/* Active left-border accent */}
                <span className={`absolute left-0 top-1 bottom-1 w-0.5 rounded-full transition-all duration-150 ${
                  isActive ? 'bg-accent opacity-100' : 'opacity-0'
                }`} />
                <Icon
                  size={16}
                  className={`flex-shrink-0 transition-colors duration-150 ${isActive ? 'text-accent' : ''}`}
                />
                <span className="text-sm truncate">{label}</span>
                {badge && (
                  <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-blue-600/20 text-blue-400 text-2xs font-semibold">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ─── Main content ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 flex-shrink-0 border-b border-edge-subtle flex items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-text-primary">
              {NAV_ITEMS.find(n => n.key === activeKey)?.label || 'Dashboard'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {loadError && (
              <span className="text-2xs text-status-blocked">Sync error</span>
            )}
            <div className="text-2xs text-text-tertiary font-mono">
              {summary?.lastSync
                ? new Date(summary.lastSync).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
                : null}
            </div>
          </div>
        </header>

        {/* View */}
        <main className="flex-1 overflow-hidden">
          {typeof children === 'function'
            ? children({ summary, refreshSummary })
            : children}
        </main>
      </div>
    </div>
  );
}
