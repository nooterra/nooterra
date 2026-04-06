import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * Animated progress/probability bar with gradient fill.
 * Animates from 0 to target width on mount.
 */
export function ProgressBar({
  value = 0,
  max = 1,
  className,
  size = 'sm',
  showLabel = true,
  gradient = true,
}) {
  const [width, setWidth] = useState(0);
  const pct = Math.max(0, Math.min(100, (value / max) * 100));

  useEffect(() => {
    // Delay to trigger CSS transition
    const timer = requestAnimationFrame(() => setWidth(pct));
    return () => cancelAnimationFrame(timer);
  }, [pct]);

  const heights = { xs: 'h-1', sm: 'h-1.5', md: 'h-2', lg: 'h-3' };
  const barHeight = heights[size] || heights.sm;

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className={cn('flex-1 rounded-full bg-surface-3 overflow-hidden', barHeight)}>
        <div
          className={cn('h-full rounded-full transition-all duration-700 ease-out', barHeight)}
          style={{
            width: `${Math.max(1, width)}%`,
            background: gradient
              ? `linear-gradient(90deg, var(--tw-color-accent, #4f8ff7) 0%, var(--tw-color-status-healthy, #34d399) 100%)`
              : undefined,
            opacity: Math.max(0.3, value / max),
          }}
        />
      </div>
      {showLabel && (
        <span className="text-2xs font-mono tabular-nums text-text-secondary w-8 text-right shrink-0">
          {Math.round(pct)}%
        </span>
      )}
    </div>
  );
}

/**
 * Thin status indicator bar (no label).
 */
export function StatusBar({ value = 0, status = 'default', className }) {
  const colors = {
    default: 'bg-accent',
    success: 'bg-status-healthy',
    warning: 'bg-status-attention',
    danger: 'bg-status-blocked',
  };

  return (
    <div className={cn('h-1 rounded-full bg-surface-3 overflow-hidden w-full', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500 ease-out', colors[status])}
        style={{ width: `${Math.max(1, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}
