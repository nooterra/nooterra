import * as React from "react";

import { cn } from "../../../lib/utils.js";

const Card = React.forwardRef(({ className, as: Comp = "div", ...props }, ref) => (
  <Comp
    ref={ref}
    className={cn(
      "rounded-3xl border border-[#2b4f68] bg-[linear-gradient(160deg,rgba(13,35,51,0.95),rgba(9,27,42,0.86))] text-[#ecf5ff] shadow-[0_18px_40px_rgba(0,0,0,0.34)]",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col space-y-2 p-5 sm:p-6 lg:p-7", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn("text-2xl font-bold tracking-[-0.01em]", className)} {...props} />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-[#acc3d8]", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-5 pb-5 pt-0 sm:px-6 sm:pb-6 lg:px-7 lg:pb-7", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center px-5 pb-5 pt-0 sm:px-6 sm:pb-6 lg:px-7 lg:pb-7", className)} {...props} />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
