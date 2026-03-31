function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatAddress(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return normalizeString(entry.address || entry.normalized || '');
}

function formatAddressList(entries) {
  if (!Array.isArray(entries)) return '';
  return entries.map((entry) => formatAddress(entry)).filter(Boolean).join(', ');
}

export function buildExecutionContextMessages({ triggerType, metadata = {} } = {}) {
  if ((triggerType !== 'webhook' && triggerType !== 'manual_test') || !metadata || typeof metadata !== 'object') {
    return [];
  }

  const webhookEvent = metadata.webhookEvent;
  if (!webhookEvent || typeof webhookEvent !== 'object') return [];

  const lines = ['Inbound webhook context for this execution:'];
  const provider = normalizeString(webhookEvent.provider);
  const channel = normalizeString(webhookEvent.channel);
  const eventType = normalizeString(webhookEvent.eventType);
  const eventId = normalizeString(webhookEvent.id);
  const from = formatAddress(webhookEvent.from);
  const to = formatAddressList(webhookEvent.to);
  const subject = normalizeString(webhookEvent.subject);
  const text = normalizeString(webhookEvent.text);

  if (provider) lines.push(`Provider: ${provider}`);
  if (channel) lines.push(`Channel: ${channel}`);
  if (eventType) lines.push(`Event type: ${eventType}`);
  if (eventId) lines.push(`Event ID: ${eventId}`);
  if (from) lines.push(`From: ${from}`);
  if (to) lines.push(`To: ${to}`);
  if (subject) lines.push(`Subject: ${subject}`);
  if (text) lines.push(`Text: ${text}`);

  lines.push('Use this inbound event as the task input for this run.');
  return [{ role: 'user', content: lines.join('\n') }];
}
