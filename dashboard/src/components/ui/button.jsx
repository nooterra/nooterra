import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-accent text-white hover:bg-accent-hover shadow-sm',
        destructive: 'bg-status-blocked text-white hover:bg-status-blocked/90 shadow-sm',
        outline: 'border border-edge bg-transparent hover:bg-surface-2 text-text-primary',
        secondary: 'bg-surface-2 text-text-primary hover:bg-surface-3',
        ghost: 'hover:bg-surface-2 text-text-secondary hover:text-text-primary',
        link: 'text-accent underline-offset-4 hover:underline',
        success: 'bg-status-healthy text-white hover:bg-status-healthy/90 shadow-sm',
      },
      size: {
        default: 'h-9 px-4 py-2 rounded-md',
        sm: 'h-7 rounded px-3 text-xs',
        lg: 'h-11 rounded-lg px-8 text-base',
        icon: 'h-9 w-9 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const Button = forwardRef(({ className, variant, size, ...props }, ref) => (
  <button
    className={cn(buttonVariants({ variant, size, className }))}
    ref={ref}
    {...props}
  />
));
Button.displayName = 'Button';

export { Button, buttonVariants };
