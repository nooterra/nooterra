import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full font-mono uppercase tracking-[0.18em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black/30",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-r from-execute to-[#f0b27a] text-void shadow-xl hover:shadow-2xl hover:-translate-y-[1px]",
        secondary:
          "glass-button border border-white/15 text-primary hover:border-white/40 hover:-translate-y-[1px]",
        ghost: "text-secondary hover:text-primary",
      },
      size: {
        sm: "px-4 py-2 text-[11px]",
        md: "px-5 py-3 text-xs",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  href?: string;
}

export const Button: React.FC<ButtonProps> = ({
  className,
  variant,
  size,
  href,
  ...props
}) => {
  const Comp: any = href ? "a" : "button";
  return (
    <Comp
      href={href}
      className={clsx(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
};

