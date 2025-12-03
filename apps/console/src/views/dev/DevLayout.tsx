import React from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  Key,
  DollarSign,
  BarChart3,
  Book,
  Settings,
  LogOut,
  Menu,
  X,
  Plus,
  Plug,
  Rocket,
  TrendingUp,
  Sparkles,
} from "lucide-react";

const navItems = [
  { to: "/dev", icon: <BarChart3 className="w-5 h-5" />, label: "Dashboard", exact: true },
  { to: "/dev/agents", icon: <Bot className="w-5 h-5" />, label: "My Agents" },
  { to: "/dev/specialized-agents", icon: <Sparkles className="w-5 h-5" />, label: "Specialized AI", highlight: true },
  { to: "/dev/deploy", icon: <Rocket className="w-5 h-5" />, label: "Deploy" },
  { to: "/dev/integrations", icon: <Plug className="w-5 h-5" />, label: "Integrations" },
  { to: "/dev/analytics", icon: <TrendingUp className="w-5 h-5" />, label: "Analytics" },
  { to: "/dev/earnings", icon: <DollarSign className="w-5 h-5" />, label: "Earnings" },
  { to: "/dev/settings", icon: <Settings className="w-5 h-5" />, label: "Settings" },
];

export default function DevLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [user, setUser] = React.useState<any>(null);

  React.useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored) {
      setUser(JSON.parse(stored));
    } else {
      navigate("/login");
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
  };

  const isActive = (to: string, exact?: boolean) => {
    if (exact) return location.pathname === to;
    return location.pathname.startsWith(to);
  };

  return (
    <div className="min-h-screen bg-[#050508] flex">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 bg-[#0a0a12] border-r border-[#4f7cff]/10
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}
      >
        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-5 border-b border-[#4f7cff]/10">
            <Link to="/" className="flex items-center gap-3">
              <img src="/logo.svg" alt="Nooterra" className="w-8 h-8" />
              <div>
                <span className="font-semibold text-white">Nooterra</span>
                <span className="ml-2 text-[10px] bg-[#a855f7]/20 text-[#a855f7] px-1.5 py-0.5 rounded">
                  DEV
                </span>
              </div>
            </Link>
            <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-[#707090]">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Deploy Agent Button */}
          <div className="p-4">
            <Link
              to="/dev/agents/new"
              className="flex items-center justify-center gap-2 w-full py-3 bg-[#a855f7]/10 hover:bg-[#a855f7]/20 border border-[#a855f7]/30 rounded-lg text-[#a855f7] text-sm font-medium transition-all"
            >
              <Plus className="w-4 h-4" /> Deploy New Agent
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-2 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all
                  ${
                    isActive(item.to, (item as any).exact)
                      ? "bg-[#a855f7]/15 text-[#a855f7]"
                      : (item as any).highlight
                      ? "text-[#39ff8e] hover:text-white hover:bg-[#39ff8e]/10 bg-[#39ff8e]/5"
                      : "text-[#707090] hover:text-white hover:bg-[#a855f7]/5"
                  }
                `}
              >
                {item.icon}
                <span>{item.label}</span>
                {(item as any).highlight && (
                  <span className="ml-auto text-[9px] bg-[#39ff8e]/20 text-[#39ff8e] px-1.5 py-0.5 rounded-full">
                    NEW
                  </span>
                )}
              </Link>
            ))}
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-[#4f7cff]/10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#a855f7] to-[#e040fb] flex items-center justify-center text-white font-medium text-sm">
                {user?.name?.charAt(0).toUpperCase() || "D"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{user?.name || "Developer"}</div>
                <div className="text-xs text-[#505060] truncate">{user?.email}</div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-[#707090] hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-all"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-screen">
        {/* Mobile header */}
        <header className="lg:hidden h-14 flex items-center justify-between px-4 border-b border-[#4f7cff]/10 bg-[#0a0a12]">
          <button onClick={() => setSidebarOpen(true)} className="text-[#707090]">
            <Menu className="w-6 h-6" />
          </button>
          <Link to="/">
            <img src="/logo.svg" alt="Nooterra" className="w-8 h-8" />
          </Link>
          <div className="w-6" />
        </header>

        <Outlet />
      </main>
    </div>
  );
}

