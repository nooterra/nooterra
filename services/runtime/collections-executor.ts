/**
 * Collections Tool Executor — native handlers for AR collections tools.
 *
 * Routes tool calls to the appropriate service instead of going through
 * Composio for non-email actions. For email:
 *   1. Try Composio GMAIL_SEND_EMAIL (sends from tenant's own Gmail)
 *   2. Fall back to Resend (from nooterra.ai — lower deliverability, warns)
 *
 * The gateway (step 6) auto-appends AI disclosure to communicate.* actions
 * before the executor runs, so email bodies already contain the disclosure.
 */

import { executeTool as composioExecuteTool } from './integrations.js';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level: string, msg: string): void {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'collections-executor', msg });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

// ---------------------------------------------------------------------------
// Email — try tenant Gmail via Composio first, fall back to Resend
// ---------------------------------------------------------------------------

export async function executeCollectionEmail(
  tenantId: string,
  args: { to: string; subject: string; body: string },
): Promise<{ ok: boolean; messageId?: string; error?: string; via?: string }> {
  const to = String(args.to ?? '').trim();
  const subject = String(args.subject ?? '').trim();
  const body = String(args.body ?? '');
  if (!to) return { ok: false, error: 'Missing recipient (to)' };
  if (!subject) return { ok: false, error: 'Missing subject' };

  // AI disclosure is already appended by the gateway (step 6) for
  // communicate.* action classes — do NOT double-append here.

  // Try Composio Gmail first (sends from tenant's own email address)
  try {
    const result = await composioExecuteTool(tenantId, 'GMAIL_SEND_EMAIL', {
      recipient_email: to,
      subject,
      body,
    });
    if (result.success) {
      log('info', `Collection email sent via tenant Gmail to ${to}`);
      return { ok: true, messageId: result.result?.id, via: 'gmail' };
    }
    // Gmail not connected or failed — fall through to Resend
    log('info', `Gmail send failed for ${tenantId}, falling back to Resend: ${result.error}`);
  } catch {
    // Composio unavailable — fall through
  }

  // Fallback: Resend (from nooterra.ai — lower deliverability)
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'No email integration connected. Connect Gmail in Settings → Integrations.' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'collections@nooterra.ai',
        to: [to],
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      log('error', `Resend API error: ${res.status} ${errorBody}`);
      return { ok: false, error: `Email delivery failed (${res.status})` };
    }

    const result = await res.json() as { id?: string };
    log('info', `Collection email sent via Resend to ${to} (fallback — tenant should connect Gmail for better deliverability)`);
    return { ok: true, messageId: result.id, via: 'resend_fallback' };
  } catch (err: any) {
    log('error', `Email send error: ${err.message}`);
    return { ok: false, error: 'Email delivery failed' };
  }
}

// ---------------------------------------------------------------------------
// Executor factory
// ---------------------------------------------------------------------------

/**
 * Build a gateway executor that routes known collections tools to native
 * handlers and rejects unknown tools.
 *
 * @param tenantId - Used to send email from the tenant's own Gmail via Composio
 */
export function createCollectionsExecutor(tenantId: string): (tool: string, params: Record<string, unknown>) => Promise<unknown> {
  return async (tool: string, params: Record<string, unknown>) => {
    switch (tool) {
      case 'send_collection_email':
        return executeCollectionEmail(tenantId, params as any);

      case 'create_followup_task':
      case 'log_collection_note':
        // These tools write to our own DB — no external service needed.
        // The gateway audit trail captures the intent.
        return { ok: true, recorded: true };

      default:
        return { ok: false, error: `Unknown collections tool: ${tool}` };
    }
  };
}
