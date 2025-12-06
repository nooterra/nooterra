import React from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  BarChart2,
  Key,
  Settings,
  Plus,
  Terminal,
  Database,
  ChevronRight,
  ArrowLeft
} from 'lucide-react';

export default function DevLayout() {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <div className="flex h-screen bg-black text-white selection:bg-primary-500/30 overflow-hidden font-mono">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 flex flex-col bg-surface-950/80 backdrop-blur-xl">
        {/* Logo Area */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-surface-800 border border-white/10 flex items-center justify-center text-primary-400 font-bold text-sm">
              DEV
            </div>
            <span className="font-semibold tracking-tight font-sans">Console</span>
          </div>
          <NavLink to="/app" className="text-surface-500 hover:text-white" title="Back to App">
            <ArrowLeft className="w-4 h-4" />
          </NavLink>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <div className="text-[10px] font-bold text-surface-600 px-3 py-2 uppercase tracking-widest mb-2 font-sans">
            Orchestration
          </div>

          <NavItem to="/dev" end icon={<LayoutDashboard className="w-4 h-4" />}>Mission Control</NavItem>
          <NavItem to="/dev/agents" icon={<Bot className="w-4 h-4" />}>My Agents</NavItem>
          <NavItem to="/dev/analytics" icon={<BarChart2 className="w-4 h-4" />}>Telemetry</NavItem>

          <div className="text-[10px] font-bold text-surface-600 px-3 py-2 uppercase tracking-widest mt-6 mb-2 font-sans">
            Configuration
          </div>
          <NavItem to="/dev/keys" icon={<Key className="w-4 h-4" />}>API Keys</NavItem>
          <NavItem to="/dev/integrations" icon={<Database className="w-4 h-4" />}>Integrations</NavItem>
          <NavItem to="/dev/logs" icon={<Terminal className="w-4 h-4" />}>Logs</NavItem>
          <NavItem to="/dev/settings" icon={<Settings className="w-4 h-4" />}>Settings</NavItem>
        </nav>

        {/* Quick Action */}
        <div className="p-4 border-t border-white/5">
          <NavLink to="/dev/agents/new" className="flex items-center justify-center gap-2 w-full py-2 bg-primary-600 hover:bg-primary-500 text-white rounded text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Deploy Agent
          </NavLink>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-black font-sans">
        {/* Top Header */}
        <header className="h-14 border-b border-white/5 flex items-center px-6 justify-between bg-black/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2 text-sm text-surface-400 font-mono">
            <span>root</span>
            <span className="text-surface-600">/</span>
            <span>dev</span>
            <span className="text-surface-600">/</span>
            <span className="text-primary-400">{pageTitle}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-surface-500 font-mono">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              MAINNET
            </div>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

const NavItem = ({ to, children, icon, end = false }: { to: string, children: React.ReactNode, icon: React.ReactNode, end?: boolean }) => (
  <NavLink
    to={to}
    end={end}
    className={({ isActive }) => `
      flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-all duration-200
      ${isActive
        ? 'bg-white/10 text-white border-l-2 border-primary-500'
        : 'text-surface-400 hover:text-white hover:bg-white/5 border-l-2 border-transparent'}
    `}
  >
    {icon}
    {children}
  </NavLink>
);

function getPageTitle(path: string) {
  const segment = path.split('/').pop();
  if (!segment || segment === 'dev') return 'dashboard';
  return segment;
}
