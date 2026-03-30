/**
 * Scheduled Daily Reports
 *
 * Generates and emails a daily summary for each tenant:
 *   - Queries last 24h of executions, approvals, spend, errors
 *   - Generates a concise LLM summary (3-5 bullet points)
 *   - Sends via Resend email
 *   - Stores the report in the scheduled_reports table
 *
 * Designed to be called by setInterval (every 24h) or an external cron.
 */

import { chatCompletion } from './openrouter.js';
import { executeBuiltinTool } from './builtin-tools.js';

const REPORT_MODEL = process.env.REPORT_MODEL || 'google/gemini-2.5-flash';
const REPORT_HOUR_UTC = parseInt(process.env.REPORT_HOUR_UTC || '8', 10); // default 8 AM UTC

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, component: 'scheduled-reports', msg });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

/**
 * Gather metrics for a tenant over the last 24 hours.
 */
async function gatherMetrics(pool, tenantId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Executions completed
  const execResult = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE status = 'failed' OR status = 'error')::int AS failed,
       COALESCE(SUM(cost_usd), 0)::numeric AS total_cost,
       COALESCE(SUM(tokens_in), 0)::bigint AS total_tokens_in,
       COALESCE(SUM(tokens_out), 0)::bigint AS total_tokens_out,
       COALESCE(SUM(tool_calls), 0)::int AS total_tool_calls
     FROM worker_executions
     WHERE tenant_id = $1 AND started_at >= $2`,
    [tenantId, since]
  );

  // Approvals processed
  const approvalResult = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
       COUNT(*) FILTER (WHERE status = 'denied')::int AS denied,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
     FROM worker_approvals
     WHERE tenant_id = $1 AND created_at >= $2`,
    [tenantId, since]
  );

  // Active workers
  const workersResult = await pool.query(
    `SELECT COUNT(*)::int AS active FROM workers WHERE tenant_id = $1 AND status IN ('ready', 'running')`,
    [tenantId]
  );

  // Error details (last 5 errors)
  const errorsResult = await pool.query(
    `SELECT w.name AS worker_name, e.error, e.started_at
     FROM worker_executions e
     LEFT JOIN workers w ON w.id = e.worker_id
     WHERE e.tenant_id = $1 AND e.started_at >= $2 AND e.status IN ('failed', 'error')
     ORDER BY e.started_at DESC LIMIT 5`,
    [tenantId, since]
  );

  const exec = execResult.rows[0];
  const approval = approvalResult.rows[0];
  const workers = workersResult.rows[0];

  return {
    executions: {
      total: exec.total,
      completed: exec.completed,
      failed: exec.failed,
      cost_usd: parseFloat(exec.total_cost),
      tokens_in: parseInt(exec.total_tokens_in),
      tokens_out: parseInt(exec.total_tokens_out),
      tool_calls: exec.total_tool_calls,
    },
    approvals: {
      total: approval.total,
      approved: approval.approved,
      denied: approval.denied,
      pending: approval.pending,
    },
    active_workers: workers.active,
    recent_errors: errorsResult.rows.map(e => ({
      worker: e.worker_name || 'Unknown',
      error: (e.error || '').slice(0, 200),
      at: e.started_at,
    })),
  };
}

/**
 * Generate a summary using the LLM.
 */
async function generateSummary(metrics) {
  const prompt = `You are a concise operations reporting assistant for an AI workforce platform called Nooterra.

Given the following 24-hour metrics, write exactly 3-5 bullet points summarizing the key takeaways. Be specific with numbers. Highlight anything concerning (errors, high costs, pending approvals). If everything looks good, say so briefly.

Metrics:
- Executions: ${metrics.executions.total} total (${metrics.executions.completed} completed, ${metrics.executions.failed} failed)
- Total spend: $${metrics.executions.cost_usd.toFixed(4)}
- Tokens used: ${metrics.executions.tokens_in.toLocaleString()} in / ${metrics.executions.tokens_out.toLocaleString()} out
- Tool calls made: ${metrics.executions.tool_calls}
- Approvals: ${metrics.approvals.total} total (${metrics.approvals.approved} approved, ${metrics.approvals.denied} denied, ${metrics.approvals.pending} pending)
- Active workers: ${metrics.active_workers}
${metrics.recent_errors.length > 0 ? `- Recent errors:\n${metrics.recent_errors.map(e => `  - ${e.worker}: ${e.error}`).join('\n')}` : '- No errors in the last 24h'}

Write ONLY the bullet points, no intro or outro. Use plain text, not markdown.`;

  try {
    const response = await chatCompletion({
      model: REPORT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 500,
      temperature: 0.3,
    });

    const content = response?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');
    return content.trim();
  } catch (err) {
    log('error', `LLM summary failed: ${err.message}`);
    // Fallback: generate a simple summary from metrics
    const lines = [];
    lines.push(`- ${metrics.executions.total} executions (${metrics.executions.completed} completed, ${metrics.executions.failed} failed)`);
    lines.push(`- Total spend: $${metrics.executions.cost_usd.toFixed(4)}`);
    if (metrics.approvals.pending > 0) {
      lines.push(`- ${metrics.approvals.pending} approvals still pending`);
    }
    if (metrics.recent_errors.length > 0) {
      lines.push(`- ${metrics.recent_errors.length} error(s) in the last 24h`);
    }
    lines.push(`- ${metrics.active_workers} active worker(s)`);
    return lines.join('\n');
  }
}

/**
 * Send the report email for a tenant.
 */
async function sendReportEmail(tenantEmail, tenantName, summary, metrics, reportDate) {
  const subject = `Nooterra Daily Report - ${reportDate}`;
  const body = `Daily Report for ${tenantName || 'your workspace'} (${reportDate})

${summary}

---
Quick stats:
  Executions: ${metrics.executions.total} | Spend: $${metrics.executions.cost_usd.toFixed(4)} | Errors: ${metrics.executions.failed} | Active workers: ${metrics.active_workers}

This is an automated report from Nooterra. Manage your preferences in the dashboard.`;

  const result = await executeBuiltinTool('send_email', {
    to: tenantEmail,
    subject,
    body,
  });

  return result;
}

/**
 * Run daily reports for all tenants.
 * Checks whether a report has already been generated today for each tenant.
 */
export async function runDailyReports(pool) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  log('info', `Running daily reports for ${today}`);

  let tenants;
  try {
    // Get all tenants that have at least one active worker and a contact email
    tenants = await pool.query(
      `SELECT DISTINCT t.id, t.name, t.contact_email
       FROM tenants t
       INNER JOIN workers w ON w.tenant_id = t.id AND w.status IN ('ready', 'running')
       WHERE t.contact_email IS NOT NULL AND t.contact_email != ''`
    );
  } catch (err) {
    // If the contact_email column doesn't exist, try a simpler query
    log('error', `Tenant query failed: ${err.message}. Trying fallback.`);
    try {
      tenants = await pool.query(
        `SELECT DISTINCT t.id, t.name
         FROM tenants t
         INNER JOIN workers w ON w.tenant_id = t.id AND w.status IN ('ready', 'running')`
      );
    } catch (err2) {
      log('error', `Fallback tenant query also failed: ${err2.message}`);
      return;
    }
  }

  if (!tenants?.rows?.length) {
    log('info', 'No active tenants found for daily reports');
    return;
  }

  let generated = 0;
  let skipped = 0;

  for (const tenant of tenants.rows) {
    try {
      // Check if report already exists for today
      const existing = await pool.query(
        `SELECT id FROM scheduled_reports WHERE tenant_id = $1 AND report_date = $2`,
        [tenant.id, today]
      );
      if (existing.rowCount > 0) {
        skipped++;
        continue;
      }

      // Gather metrics
      const metrics = await gatherMetrics(pool, tenant.id);

      // Skip if there was no activity
      if (metrics.executions.total === 0 && metrics.approvals.total === 0) {
        skipped++;
        continue;
      }

      // Generate summary
      const summary = await generateSummary(metrics);

      // Store report
      await pool.query(
        `INSERT INTO scheduled_reports (tenant_id, report_date, summary, metrics, sent_at, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
         ON CONFLICT (tenant_id, report_date) DO NOTHING`,
        [tenant.id, today, summary, JSON.stringify(metrics), null]
      );

      // Send email if tenant has a contact email
      const email = tenant.contact_email;
      if (email) {
        try {
          const emailResult = await sendReportEmail(email, tenant.name, summary, metrics, today);
          if (emailResult?.success) {
            await pool.query(
              `UPDATE scheduled_reports SET sent_at = NOW() WHERE tenant_id = $1 AND report_date = $2`,
              [tenant.id, today]
            );
          }
        } catch (emailErr) {
          log('error', `Failed to send report email for tenant ${tenant.id}: ${emailErr.message}`);
        }
      }

      generated++;
      log('info', `Report generated for tenant ${tenant.id}: ${metrics.executions.total} executions, $${metrics.executions.cost_usd.toFixed(4)} spend`);
    } catch (err) {
      log('error', `Report generation failed for tenant ${tenant.id}: ${err.message}`);
    }
  }

  log('info', `Daily reports complete: ${generated} generated, ${skipped} skipped`);
}

/**
 * Start the report scheduler. Runs every hour, but only generates
 * reports at the configured REPORT_HOUR_UTC. Safe to call multiple times;
 * the idempotent check on (tenant_id, report_date) prevents duplicates.
 */
export function startReportScheduler(pool) {
  const INTERVAL_MS = 60 * 60 * 1000; // Check every hour

  async function tick() {
    const nowHour = new Date().getUTCHours();
    if (nowHour === REPORT_HOUR_UTC) {
      try {
        await runDailyReports(pool);
      } catch (err) {
        log('error', `Report scheduler tick failed: ${err.message}`);
      }
    }
  }

  // Run once at startup (in case we missed the window)
  setTimeout(() => tick(), 5000);

  // Then check every hour
  const handle = setInterval(tick, INTERVAL_MS);

  log('info', `Report scheduler started — reports at ${REPORT_HOUR_UTC}:00 UTC`);
  return handle;
}

export default { runDailyReports, startReportScheduler };
