/**
 * World Runtime Shell — the product chrome.
 *
 * Slim sidebar, top status bar, embedded view.
 * Dark, dense, feels like Bloomberg Terminal meets Linear.
 * Navigation between all 6 world runtime views.
 */

import { useState, useEffect, lazy, Suspense } from 'react';
import {
  LayoutDashboard, Database, TrendingUp, Grid3x3, Shield,
  CheckSquare, Settings, ChevronLeft, ChevronRight,
  Bell, Search, Zap, Activity,
} from 'lucide-react';

// Lazy load all views
const CommandCenter = lazy(() => import('./CommandCenter.jsx'));
const CompanyState = lazy(() => import('./CompanyState.jsx'));
const PredictionDashboard = lazy(() => import('./PredictionDashboard.jsx'));
const AutonomyMap = lazy(() => import('./AutonomyMap.jsx'));
const PolicyEditor = lazy(() => import('./PolicyEditor.jsx'));
const ApprovalQueue = lazy(() => import('./ApprovalQueue.jsx'));

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { key: 'command',     label: 'Runtime Overview', icon: LayoutDashboard, path: '/command' },
  { key: 'state',       label: 'Company State',    icon: Database,        path: '/state' },
  { key: 'predictions', label: 'Predictions',     icon: TrendingUp,      path: '/predictions' },
  { key: 'autonomy',    label: 'Autonomy Map',    icon: Grid3x3,         path: '/autonomy' },
  { key: 'policies',    label: 'Policy Runtime',   icon: Shield,          path: '/policies' },
  { key: 'queue',       label: 'Action Gateway',   icon: CheckSquare,     path: '/queue' },
];

const VIEW_MAP = {
  command: CommandCenter,
  state: CompanyState,
  predictions: PredictionDashboard,
  autonomy: AutonomyMap,
  policies: PolicyEditor,
  queue: ApprovalQueue,
};

// ---------------------------------------------------------------------------
// Live clock
// ---------------------------------------------------------------------------

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="text-2xs font-mono text-text-tertiary tabular-nums">
      {now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// System pulse — fake "live" indicator
// ---------------------------------------------------------------------------

function SystemPulse() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-healthy opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-status-healthy" />
      </span>
      <span className="text-2xs text-status-healthy font-medium">Live</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export default function WorldRuntimeShell({ initialView }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('nooterra_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('nooterra_sidebar_collapsed', String(next)); } catch {}
      return next;
    });
  };
  const [activeKey, setActiveKey] = useState(initialView || 'command');

  // Sync with URL
  useEffect(() => {
    const path = window.location.pathname;
    const match = NAV_ITEMS.find(n => n.path === path);
    if (match) setActiveKey(match.key);
  }, []);

  const navigate = (key) => {
    setActiveKey(key);
    const item = NAV_ITEMS.find(n => n.key === key);
    if (item) window.history.pushState({}, '', item.path);
  };

  // Handle browser back/forward
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      const match = NAV_ITEMS.find(n => n.path === path);
      if (match) setActiveKey(match.key);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const ActiveView = VIEW_MAP[activeKey] || CommandCenter;
  const activeLabel = NAV_ITEMS.find(n => n.key === activeKey)?.label || 'Command Center';

  return (
    <div className="flex h-screen bg-surface-0 text-text-primary overflow-hidden">
      {/* ─── Sidebar ─── */}
      <aside className={`flex-shrink-0 flex flex-col border-r border-edge bg-surface-1 transition-all duration-300 ease-in-out ${
        collapsed ? 'w-14' : 'w-52'
      }`}>
        {/* Logo */}
        <div className="h-12 flex items-center px-3.5 border-b border-edge-subtle">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded bg-accent/20 flex items-center justify-center flex-shrink-0">
              <Zap size={12} className="text-accent" />
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold tracking-tight truncate">nooterra</span>
            )}
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-2 px-2 space-y-0.5">
          {NAV_ITEMS.map(({ key, label, icon: Icon, badge }) => {
            const isActive = activeKey === key;
            return (
              <button
                key={key}
                onClick={() => navigate(key)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded transition-all duration-150 text-left group relative
                  ${isActive
                    ? 'bg-surface-3 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-2'
                  }`}
                title={collapsed ? label : undefined}
              >
                {/* Active left-border accent */}
                <span className={`absolute left-0 top-1 bottom-1 w-0.5 rounded-full transition-all duration-150 ${
                  isActive ? 'bg-accent opacity-100' : 'opacity-0'
                }`} />
                <Icon size={16} className={`flex-shrink-0 transition-colors duration-150 ${isActive ? 'text-accent' : ''}`} />
                {!collapsed && (
                  <>
                    <span className="text-sm truncate">{label}</span>
                    {badge && (
                      <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-status-attention/20 text-status-attention text-2xs font-semibold">
                        {badge}
                      </span>
                    )}
                  </>
                )}
                {collapsed && badge && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-status-attention" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="border-t border-edge-subtle px-2 py-2 space-y-0.5">
          <button
            onClick={toggleCollapsed}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-2 transition-colors"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            {!collapsed && <span className="text-sm">Collapse</span>}
          </button>
        </div>

        {/* User */}
        <div className="border-t border-edge-subtle px-3 py-3 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-accent">
            A
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">Aiden</p>
              <p className="text-2xs text-text-tertiary truncate">Owner</p>
            </div>
          )}
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-12 flex-shrink-0 border-b border-edge-subtle flex items-center justify-between px-5">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-medium text-text-primary">{activeLabel}</h1>
            <SystemPulse />
          </div>
          <div className="flex items-center gap-4">
            <LiveClock />
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 border border-edge text-2xs text-text-tertiary hover:text-text-secondary transition-colors">
              <Search size={12} />
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden md:inline ml-2 px-1 py-0.5 rounded border border-edge text-2xs font-mono">⌘K</kbd>
            </button>
            <button className="relative p-1.5 rounded hover:bg-surface-2 transition-colors text-text-tertiary hover:text-text-secondary">
              <Bell size={16} />
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-status-attention" />
            </button>
          </div>
        </header>

        {/* View */}
        <main className="flex-1 overflow-hidden">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-3">
                <Activity size={16} className="text-accent animate-pulse" />
                <span className="text-sm text-text-secondary">Loading...</span>
              </div>
            </div>
          }>
            <div key={activeKey} className="h-full animate-in fade-in duration-150">
              <ActiveView />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
