import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent/15 text-accent',
        secondary: 'border-transparent bg-surface-3 text-text-secondary',
        outline: 'border-edge text-text-secondary',
        success: 'border-transparent bg-status-healthy/15 text-status-healthy',
        warning: 'border-transparent bg-status-attention/15 text-status-attention',
        destructive: 'border-transparent bg-status-blocked/15 text-status-blocked',
        muted: 'border-edge bg-surface-2 text-text-tertiary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
