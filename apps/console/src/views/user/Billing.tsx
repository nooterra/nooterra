import React from 'react';
import { CreditCard, Zap, Download } from 'lucide-react';

export default function Billing() {
  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Plan & Billing</h1>
        <p className="text-surface-400">Manage your credits and subscription.</p>
      </div>

      {/* Credit Balance Card */}
      <div className="glass-card p-8 relative overflow-hidden">
        <div className="relative z-10 flex justify-between items-start">
          <div>
            <div className="text-sm font-medium text-surface-400 mb-1 uppercase tracking-wider">Available Balance</div>
            <div className="text-4xl font-bold text-white mb-6">24,500 <span className="text-lg text-surface-500 font-normal">NCR</span></div>
            <div className="flex gap-3">
              <button className="btn-primary">Add Credits</button>
              <button className="btn-secondary">Auto-reload</button>
            </div>
          </div>
          <div className="hidden md:block w-32 h-32 rounded-full bg-primary-500/10 blur-3xl absolute -top-10 -right-10" />
        </div>
      </div>

      {/* Usage Chart Placeholder */}
      <div className="glass-card p-8">
        <h3 className="font-semibold text-white mb-6 flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary-400" /> Usage History
        </h3>
        <div className="h-64 flex items-end justify-between gap-2">
          {[45, 60, 75, 50, 80, 95, 70, 65, 85, 90, 100, 80, 60, 40].map((h, i) => (
            <div key={i} className="flex-1 bg-surface-800 hover:bg-primary-600 transition-colors rounded-t-sm" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="flex justify-between mt-4 text-xs text-surface-500 uppercase tracking-wide">
          <span>Oct 1</span>
          <span>Oct 15</span>
          <span>Oct 30</span>
        </div>
      </div>

      {/* Invoice History */}
      <div>
        <h3 className="font-semibold text-white mb-4">Invoices</h3>
        <div className="rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-900/50 text-surface-400">
              <tr>
                <th className="px-6 py-3 font-medium">Invoice</th>
                <th className="px-6 py-3 font-medium">Date</th>
                <th className="px-6 py-3 font-medium">Amount</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[
                { id: 'INV-0012', date: 'Oct 01, 2025', amount: '$50.00', status: 'Paid' },
                { id: 'INV-0011', date: 'Sep 01, 2025', amount: '$50.00', status: 'Paid' },
                { id: 'INV-0010', date: 'Aug 01, 2025', amount: '$24.00', status: 'Paid' },
              ].map((inv) => (
                <tr key={inv.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">{inv.id}</td>
                  <td className="px-6 py-4 text-surface-400">{inv.date}</td>
                  <td className="px-6 py-4 text-surface-300">{inv.amount}</td>
                  <td className="px-6 py-4"><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-400">Paid</span></td>
                  <td className="px-6 py-4 text-right">
                    <button className="p-2 hover:bg-white/10 rounded-lg text-surface-400 hover:text-white transition-colors">
                      <Download className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
