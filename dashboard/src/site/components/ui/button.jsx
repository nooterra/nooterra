import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "../../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-[#22c7a5] to-[#39d6b5] text-[#082532] shadow-[0_16px_35px_rgba(26,184,151,0.35)] hover:brightness-105 focus-visible:ring-[#2fdec0] focus-visible:ring-offset-[#071521]",
        outline:
          "border border-[#365d77] bg-[rgba(12,31,45,0.72)] text-[#e8f4ff] hover:bg-[rgba(22,53,75,0.86)] focus-visible:ring-[#55d9ba] focus-visible:ring-offset-[#071521]",
        ghost: "text-[#bed6ea] hover:bg-[rgba(20,47,67,0.72)] focus-visible:ring-[#55d9ba] focus-visible:ring-offset-[#071521]"
      },
      size: {
        default: "h-10 px-5",
        lg: "h-11 px-6 text-base",
        sm: "h-9 px-4"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? "span" : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

function buttonClasses({ variant = "default", size = "default", className = "" } = {}) {
  return cn(buttonVariants({ variant, size, className }));
}

export { Button, buttonVariants, buttonClasses };
