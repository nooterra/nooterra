import * as React from "react";
import clsx from "clsx";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: "none" | "sm" | "md";
}

export const Card: React.FC<CardProps> = ({
  className,
  padding = "md",
  children,
  ...props
}) => {
  const pad =
    padding === "none" ? "" : padding === "sm" ? "p-4" : "p-6 md:p-8";
  return (
    <div
      className={clsx(
        "glass-panel border border-white/10 rounded-2xl shadow-2xl relative overflow-hidden",
        pad,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

