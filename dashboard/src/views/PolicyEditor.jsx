import { useEffect, useMemo, useState } from 'react';
import {
  Eye, FileText, Play, RefreshCw, Shield,
} from 'lucide-react';
import { getRuntimePolicy, putRuntimePolicy } from '../lib/world-api.js';

function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function SectionCard({ title, detail, value }) {
  return (
    <div className="rounded-md bg-surface-1 border border-edge p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-text-primary">{title}</div>
          <div className="text-xs text-text-secondary mt-1">{detail}</div>
        </div>
      </div>
      <pre className="mt-3 text-xs text-text-secondary whitespace-pre-wrap break-all">
        {prettyJson(value)}
      </pre>
    </div>
  );
}

export default function PolicyEditor() {
  const [record, setRecord] = useState(null);
  const [editorValue, setEditorValue] = useState('{}');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState('');

  async function load() {
    try {
      const next = await getRuntimePolicy();
      setRecord(next);
      setEditorValue(prettyJson(next?.overrides || {}));
      setSavedAt(next?.updatedAt || '');
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load policy runtime');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sections = useMemo(() => {
    const effective = record?.effective || {};
    return [
      ['Side effects', 'Escrow and auto-pause thresholds for side-effect safety.', effective.sideEffects],
      ['Approvals', 'Approval anomaly thresholds and runtime re-entry behavior.', effective.approvals],
      ['Verification', 'Verification anomaly thresholds and critical assertion handling.', effective.verification],
      ['Webhooks', 'Webhook anomaly thresholds and cooldown behavior.', effective.webhooks],
    ];
  }, [record]);

  async function handleSave(nextValue) {
    setSaving(true);
    try {
      const parsed = JSON.parse(nextValue);
      const updated = await putRuntimePolicy(parsed);
      setRecord(updated);
      setEditorValue(prettyJson(updated?.overrides || {}));
      setSavedAt(updated?.updatedAt || new Date().toISOString());
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to save runtime policy');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    await handleSave('{}');
  }

  return (
    <div className="flex h-full">
      <div className="w-[360px] flex-shrink-0 border-r border-edge flex flex-col bg-surface-0">
        <div className="p-4 border-b border-edge-subtle">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={14} className="text-accent" />
            <h2 className="text-sm font-medium text-text-primary">Policy runtime</h2>
          </div>
          <p className="text-xs text-text-secondary">
            Structured runtime enforcement policy. This milestone exposes the real policy surface,
            not a fictional natural-language compiler.
          </p>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {sections.map(([title, detail, value]) => (
            <SectionCard key={title} title={title} detail={detail} value={value} />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-md font-semibold text-text-primary">Tenant runtime overrides</h2>
              <div className="flex items-center gap-3 mt-1 text-2xs text-text-tertiary">
                <span>Version {record?.version || 1}</span>
                <span>{savedAt ? `Updated ${new Date(savedAt).toLocaleString()}` : 'Using defaults'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-text-secondary border border-edge hover:border-edge-strong transition-colors"
              >
                <RefreshCw size={12} /> Refresh
              </button>
              <button
                onClick={handleReset}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-text-secondary border border-edge hover:border-edge-strong transition-colors disabled:opacity-50"
              >
                <Play size={12} /> Reset to defaults
              </button>
            </div>
          </div>

          {error ? (
            <div className="mb-4 rounded-lg border border-status-blocked/30 bg-status-blocked-muted px-4 py-3 text-sm text-status-blocked">
              {error}
            </div>
          ) : null}

          <div className="mb-6">
            <div className="flex items-center gap-1.5 mb-2">
              <FileText size={12} className="text-text-tertiary" />
              <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">Override JSON</span>
            </div>
            <textarea
              value={editorValue}
              onChange={(event) => setEditorValue(event.target.value)}
              className="w-full h-72 p-3 bg-surface-2 border border-edge rounded-md text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none font-mono"
            />
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => handleSave(editorValue)}
                disabled={saving}
                className="px-3 py-1.5 rounded text-xs bg-accent hover:bg-accent-hover text-white transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save overrides'}
              </button>
              <span className="text-2xs text-text-tertiary">
                Send `{}` to use platform defaults only.
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Eye size={12} className="text-text-tertiary" />
              <span className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">Effective runtime policy</span>
            </div>
            <div className="rounded-md bg-surface-1 border border-edge p-4">
              <pre className="text-xs text-text-secondary whitespace-pre-wrap break-all">
                {prettyJson(record?.effective || {})}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
