import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * Animated number that counts up from 0 to target value.
 * Uses requestAnimationFrame for smooth 60fps animation.
 */
export function AnimatedNumber({
  value,
  duration = 800,
  format = (v) => v.toLocaleString(),
  className,
  prefix = '',
  suffix = '',
}) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);
  const frameRef = useRef(null);

  useEffect(() => {
    const start = prevValue.current;
    const end = Number(value) || 0;
    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;
      setDisplay(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        prevValue.current = end;
      }
    }

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}{format(display)}{suffix}
    </span>
  );
}

export function AnimatedMoney({ cents, className, ...props }) {
  const dollars = Number(cents || 0) / 100;
  return (
    <AnimatedNumber
      value={dollars}
      format={(v) => {
        if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
        if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
        return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
      }}
      prefix="$"
      className={className}
      {...props}
    />
  );
}

export function AnimatedPercent({ value, className, ...props }) {
  return (
    <AnimatedNumber
      value={Math.round((Number(value) || 0) * 100)}
      format={(v) => Math.round(v).toString()}
      suffix="%"
      className={className}
      {...props}
    />
  );
}
