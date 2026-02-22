import * as React from "react";

import { cn } from "../../../lib/utils.js";

function Badge({ className, variant = "default", ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em]",
        variant === "default" && "border-[#3a5f78] bg-[rgba(13,32,47,0.85)] text-[#bdd5e8]",
        variant === "accent" && "border-[#2f7f74] bg-[rgba(19,78,73,0.38)] text-[#9df4df]",
        className
      )}
      {...props}
    />
  );
}

export { Badge };
