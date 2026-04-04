/**
 * Collections Tool Executor — native handlers for AR collections tools.
 *
 * Routes tool calls to the appropriate service instead of going through
 * Composio. Currently handles:
 *   - send_collection_email → Resend API
 *   - create_followup_task → internal DB (pass-through)
 *   - log_collection_note  → internal DB (pass-through)
 *
 * The gateway (step 6) auto-appends AI disclosure to communicate.* actions
 * before the executor runs, so email bodies already contain the disclosure.
 */

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
// Email via Resend
// ---------------------------------------------------------------------------

export async function executeCollectionEmail(
  args: { to: string; subject: string; body: string },
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'Email sending not configured (RESEND_API_KEY missing)' };
  }

  const to = String(args.to ?? '').trim();
  const subject = String(args.subject ?? '').trim();
  const body = String(args.body ?? '');
  if (!to) return { ok: false, error: 'Missing recipient (to)' };
  if (!subject) return { ok: false, error: 'Missing subject' };

  // AI disclosure is already appended by the gateway (step 6) for
  // communicate.* action classes — do NOT double-append here.

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
    log('info', `Collection email sent to ${to}: ${result.id}`);
    return { ok: true, messageId: result.id };
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
 */
export function createCollectionsExecutor(): (tool: string, params: Record<string, unknown>) => Promise<unknown> {
  return async (tool: string, params: Record<string, unknown>) => {
    switch (tool) {
      case 'send_collection_email':
        return executeCollectionEmail(params as any);

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
