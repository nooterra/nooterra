/**
 * Deadline Rules — deterministic deadline/SLA calculations.
 */

export interface DeadlineCheck {
  objectId: string;
  objectType: string;
  field: string;
  dueAt: Date;
  status: 'on_track' | 'at_risk' | 'overdue' | 'breached';
  daysRemaining: number;
  daysOverdue: number;
}

/**
 * Check all deadlines for a set of objects.
 * Returns items that are at risk or overdue.
 */
export function checkDeadlines(
  objects: { id: string; type: string; state: Record<string, unknown> }[],
  warningDays = 3,
): DeadlineCheck[] {
  const results: DeadlineCheck[] = [];
  const now = new Date();

  for (const obj of objects) {
    // Check common deadline fields
    for (const field of ['dueAt', 'due_at', 'expiresAt', 'expires_at', 'deadline']) {
      const rawDate = obj.state[field];
      if (!rawDate) continue;

      const dueAt = rawDate instanceof Date ? rawDate : new Date(rawDate as string);
      if (isNaN(dueAt.getTime())) continue;

      const msRemaining = dueAt.getTime() - now.getTime();
      const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
      const daysOverdue = Math.max(0, -daysRemaining);

      let status: DeadlineCheck['status'];
      if (daysRemaining < 0) {
        status = daysOverdue > 30 ? 'breached' : 'overdue';
      } else if (daysRemaining < warningDays) {
        status = 'at_risk';
      } else {
        status = 'on_track';
      }

      // Only report at-risk, overdue, or breached
      if (status !== 'on_track') {
        results.push({
          objectId: obj.id,
          objectType: obj.type,
          field,
          dueAt,
          status,
          daysRemaining: Math.max(0, Math.ceil(daysRemaining)),
          daysOverdue: Math.ceil(daysOverdue),
        });
      }
    }
  }

  return results.sort((a, b) => a.daysRemaining - b.daysRemaining);
}
