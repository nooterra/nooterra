import { cn } from '../../lib/utils.js';

/**
 * Empty state that teaches the interface.
 * Not just "nothing here" — explains WHY and WHAT TO DO.
 */
export function EmptyState({ title, description, action, className }) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center rounded-lg border border-dashed border-edge py-16 px-8 text-center',
      className,
    )}>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description && (
        <p className="text-xs text-text-tertiary mt-2 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
