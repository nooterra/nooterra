import React from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  Settings,
  CreditCard,
  Clock,
  LogOut,
  ChevronRight,
  LayoutGrid
} from 'lucide-react';

export default function UserLayout() {
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <div className="flex h-screen bg-black text-white selection:bg-primary-500/30 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/10 flex flex-col bg-surface-950/50 backdrop-blur-xl">
        {/* Logo Area */}
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-sm">
              N
            </div>
            <span className="font-semibold tracking-tight">Nooterra</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <div className="text-xs font-medium text-surface-500 px-3 py-2 uppercase tracking-wider mb-2">
            Workspace
          </div>

          <NavItem to="/app" end icon={<MessageSquare className="w-4 h-4" />}>Chat</NavItem>
          <NavItem to="/app/conversations" icon={<Clock className="w-4 h-4" />}>History</NavItem>

          <div className="text-xs font-medium text-surface-500 px-3 py-2 uppercase tracking-wider mt-6 mb-2">
            Account
          </div>
          <NavItem to="/app/billing" icon={<CreditCard className="w-4 h-4" />}>Plan & Billing</NavItem>
          <NavItem to="/app/settings" icon={<Settings className="w-4 h-4" />}>Preferences</NavItem>

          <div className="text-xs font-medium text-surface-500 px-3 py-2 uppercase tracking-wider mt-6 mb-2">
            Switch View
          </div>
          <NavItem to="/dev" icon={<LayoutGrid className="w-4 h-4" />}>Developer Console</NavItem>
        </nav>

        {/* User Profile */}
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-surface-700 to-surface-600 border border-white/10" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">User Name</div>
              <div className="text-xs text-surface-500 truncate">user@example.com</div>
            </div>
            <LogOut className="w-4 h-4 text-surface-500 group-hover:text-white transition-colors" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-black">
        {/* Top Header (Mobile/Breadcrumbs) */}
        <header className="h-16 border-b border-white/5 flex items-center px-8 justify-between bg-black/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-2 text-sm text-surface-400">
            <span>App</span>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white font-medium">{pageTitle}</span>
          </div>
          <div className="flex items-center gap-4">
            {/* Status Indicator */}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-surface-900 border border-white/5">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="text-xs font-medium text-surface-400">System Normal</span>
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
      flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
      ${isActive
        ? 'bg-primary-600/10 text-primary-400'
        : 'text-surface-400 hover:text-white hover:bg-white/5'}
    `}
  >
    {icon}
    {children}
  </NavLink>
);

function getPageTitle(path: string) {
  if (path === '/app') return 'Chat';
  if (path.includes('conversations')) return 'History';
  if (path.includes('billing')) return 'Plan & Billing';
  if (path.includes('settings')) return 'Preferences';
  return 'Dashboard';
}
