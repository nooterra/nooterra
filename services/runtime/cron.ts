/**
 * Cron Parser — pure functions for cron expression parsing and matching.
 * Extracted from server.js.
 */

/** Parse a 5-field cron expression into arrays of allowed values per field. */
export function parseCron(expr: string): number[][] {
  const raw = expr.trim().split(/\s+/);
  if (raw.length !== 5) {
    throw new Error(`Invalid cron: expected 5 fields, got ${raw.length} in "${expr}"`);
  }

  const ranges: [number, number][] = [
    [0, 59],  // minute
    [0, 23],  // hour
    [1, 31],  // day of month
    [1, 12],  // month
    [0, 6],   // day of week (0=Sunday)
  ];

  return raw.map((field, i) => parseField(field, ranges[i][0], ranges[i][1]));
}

function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    let range = stepMatch ? stepMatch[1] : part;
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    if (step <= 0) throw new Error(`Invalid step: ${step}`);

    if (range === '*') {
      for (let v = min; v <= max; v += step) values.add(v);
    } else if (range.includes('-')) {
      const [s, e] = range.split('-').map(Number);
      if (isNaN(s) || isNaN(e) || s < min || e > max || s > e) {
        throw new Error(`Invalid range: ${range}`);
      }
      for (let v = s; v <= e; v += step) values.add(v);
    } else {
      const val = parseInt(range, 10);
      if (isNaN(val) || val < min || val > max) {
        throw new Error(`Invalid value: ${range}`);
      }
      values.add(val);
    }
  }
  return Array.from(values).sort((a, b) => a - b);
}

/** Check if a parsed cron expression matches a given date. */
export function cronMatchesDate(parsed: number[][], date: Date): boolean {
  const vals = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  return parsed.every((allowed, i) => allowed.includes(vals[i]));
}

/** Find the next cron run after a given date. Returns null if none found within a year. */
export function nextCronRun(parsed: number[][], after: Date): Date | null {
  const maxMinutes = 366 * 24 * 60;
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < maxMinutes; i++) {
    if (cronMatchesDate(parsed, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

/**
 * Extract cron expression from a schedule object.
 * Supports { type: 'cron', value: '...' } and { type: 'interval', value: '1h' }.
 */
export function extractCronExpr(schedule: any): string | null {
  if (typeof schedule === 'string') return schedule;
  if (schedule.type === 'cron') return schedule.value;
  if (schedule.type === 'interval') return intervalToCron(schedule.value);
  if (schedule.cron) return schedule.cron;
  if (schedule.value && typeof schedule.value === 'string') return schedule.value;
  return null;
}

export function intervalToCron(value: string): string {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return '0 * * * *';
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 'm': return num > 0 && num <= 59 ? `*/${num} * * * *` : '0 * * * *';
    case 'h': return num > 0 && num <= 23 ? `0 */${num} * * *` : '0 0 * * *';
    case 'd': return num === 1 ? '0 0 * * *' : `0 0 */${num} * *`;
    case 's': return '* * * * *'; // min cron resolution
    default: return '0 * * * *';
  }
}
