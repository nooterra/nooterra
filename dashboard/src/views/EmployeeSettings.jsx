/**
 * EmployeeSettings — read-only policy boundary display for the pilot.
 *
 * Boundary changes require re-provisioning; editing is deferred.
 */

function Section({ title, children }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-widest text-text-tertiary mb-2">
        {title}
      </p>
      <div
        className="rounded-lg border border-edge p-5"
        style={{ background: '#12121a' }}
      >
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, valueClassName }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-edge-subtle last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-sm font-medium ${valueClassName || 'text-text-primary'}`}>
        {value}
      </span>
    </div>
  );
}

function formatDate(value) {
  if (!value) return 'Not synced yet';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Not synced yet';
  return d.toLocaleString();
}

export default function EmployeeSettings({ summary }) {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-xl space-y-8">

        <Section title="Profile">
          <Row label="Name"   value={summary?.name || summary?.employeeName || '—'} />
          <Row label="Role"   value="Collections Specialist" />
          <Row label="Status" value="Active" valueClassName="text-status-healthy" />
        </Section>

        <Section title="Guardrails">
          <p className="text-xs text-text-tertiary mb-4">
            Boundary changes require re-provisioning. Contact support to adjust guardrails during the pilot.
          </p>
          <Row label="Max autonomous action"  value="$5,000" />
          <Row label="Require approval above" value="$5,000" />
          <Row label="Max contacts per day"   value="100" />
          <Row label="Business hours only"    value="Yes" />
        </Section>

        <Section title="Stripe Connection">
          <Row label="Status"    value="Connected" valueClassName="text-status-healthy" />
          <Row label="Last sync" value={formatDate(summary?.lastSyncAt)} />
        </Section>

        <Section title="Danger Zone">
          <p className="text-sm text-text-secondary mb-4">
            Pausing removes the employee from active automation. The grant remains intact.
          </p>
          <button
            className="px-4 py-2 rounded border border-red-700 text-text-secondary text-sm font-medium transition-colors duration-150 hover:border-red-500 hover:text-red-400"
          >
            Pause Employee
          </button>
        </Section>

      </div>
    </div>
  );
}
