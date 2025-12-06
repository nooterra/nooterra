import React from 'react';
import { ToggleLeft, User, Bell, Shield, Key } from 'lucide-react';

export default function Settings() {
  return (
    <div className="p-8 max-w-3xl mx-auto space-y-10 mb-20">
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Preferences</h1>
        <p className="text-surface-400">Manage your profile and application settings.</p>
      </div>

      {/* Profile Section */}
      <section>
        <h3 className="font-semibold text-white mb-6 flex items-center gap-2">
          <User className="w-4 h-4 text-surface-400" /> Account
        </h3>
        <div className="glass-card p-6 space-y-6">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-surface-800 border border-white/10" />
            <div className="space-y-2">
              <button className="btn-secondary py-2 text-xs">Change Avatar</button>
              <p className="text-xs text-surface-500">JPG, GIF or PNG. Max 1MB.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">First Name</label>
              <input type="text" defaultValue="Rocz" className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">Last Name</label>
              <input type="text" defaultValue="Nooterra" className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500 transition-colors" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1.5">Email Address</label>
            <input type="email" defaultValue="user@nooterra.ai" className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500 transition-colors" />
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section>
        <h3 className="font-semibold text-white mb-6 flex items-center gap-2">
          <Bell className="w-4 h-4 text-surface-400" /> Notifications
        </h3>
        <div className="glass-card divide-y divide-white/5">
          <ToggleRow title="Email Notifications" desc="Receive daily summaries and alerts" defaultChecked />
          <ToggleRow title="Product Updates" desc="New features and network announcements" defaultChecked />
          <ToggleRow title="Security Alerts" desc="Critical security notifications" defaultChecked />
        </div>
      </section>

      {/* Security */}
      <section>
        <h3 className="font-semibold text-white mb-6 flex items-center gap-2">
          <Shield className="w-4 h-4 text-surface-400" /> Security
        </h3>
        <div className="glass-card divide-y divide-white/5">
          <div className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-white text-sm">Two-Factor Authentication</div>
              <div className="text-xs text-surface-400 mt-1">Add an extra layer of security to your account</div>
            </div>
            <button className="btn-secondary py-1.5 text-xs">Enable</button>
          </div>

          <div className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium text-white text-sm">API Keys</div>
              <div className="text-xs text-surface-400 mt-1">Manage your access tokens</div>
            </div>
            <button className="btn-secondary py-1.5 text-xs">Manage</button>
          </div>
        </div>
      </section>

      <div className="pt-6 border-t border-white/10 flex justify-end gap-3">
        <button className="btn-secondary">Cancel</button>
        <button className="btn-primary">Save Changes</button>
      </div>
    </div>
  );
}

const ToggleRow = ({ title, desc, defaultChecked }: { title: string, desc: string, defaultChecked?: boolean }) => {
  const [checked, setChecked] = React.useState(defaultChecked || false);
  return (
    <div className="p-4 flex items-center justify-between">
      <div>
        <div className="font-medium text-white text-sm">{title}</div>
        <div className="text-xs text-surface-400 mt-1">{desc}</div>
      </div>
      <button
        onClick={() => setChecked(!checked)}
        className={`w-11 h-6 rounded-full relative transition-colors ${checked ? 'bg-primary-600' : 'bg-surface-700'}`}
      >
        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </div>
  );
}
