import { cn } from '../../lib/utils.js';
import { AnimatedNumber } from './animated-number.jsx';
import { FadeIn } from './stagger.jsx';

/**
 * Metric card for KPI display. Stripe-style: label up top, big number, detail below.
 * Optional top border accent based on status.
 */
export function MetricCard({
  label,
  value,
  detail,
  trend,
  status,
  delay = 0,
  className,
  children,
}) {
  const borderColor = {
    good: 'border-t-status-healthy',
    warn: 'border-t-status-attention',
    bad: 'border-t-status-blocked',
    accent: 'border-t-accent',
  }[status] || 'border-t-transparent';

  return (
    <FadeIn delay={delay}>
      <div className={cn(
        'rounded-lg border border-edge bg-surface-1 border-t-2 overflow-hidden',
        borderColor,
        className,
      )}>
        <div className="p-5">
          <div className="text-2xs uppercase tracking-[0.1em] text-text-tertiary mb-3 font-medium">
            {label}
          </div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-text-primary leading-none">
            {typeof value === 'number' ? (
              <AnimatedNumber value={value} format={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            ) : (
              value
            )}
          </div>
          {(detail || trend) && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-edge-subtle">
              {detail && <span className="text-2xs text-text-tertiary">{detail}</span>}
              {trend && <span className="text-2xs font-mono text-text-secondary">{trend}</span>}
            </div>
          )}
          {children}
        </div>
      </div>
    </FadeIn>
  );
}
