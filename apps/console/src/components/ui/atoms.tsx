import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Badge = ({ children, color = "signal" }: { children: React.ReactNode; color?: "signal" | "execute" | "settle" }) => {
  const colors = {
    signal: "text-signal border-signal/20 bg-signal/10",
    execute: "text-execute border-execute/20 bg-execute/10",
    settle: "text-settle border-settle/20 bg-settle/10",
  };

  return (
    <span className={cn("px-2 py-0.5 text-xs font-mono rounded-full border", colors[color])}>
      {children}
    </span>
  );
};

export const Button = ({
  href,
  children,
  variant = "primary"
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary"
}) => {
  const base =
    "relative overflow-hidden inline-flex items-center gap-2 px-6 py-3 text-sm font-medium transition-all duration-300 group rounded-md";
  const styles = {
    primary:
      "text-void bg-gradient-to-r from-cyan-300 via-blue-400 to-fuchsia-400 animate-gradient bg-[length:200%_200%] shadow-[0_8px_30px_rgba(99,102,241,0.35)] hover:scale-[1.02]",
    secondary:
      "glass-panel text-secondary hover:text-primary hover:border-primary/30 bg-white/5 backdrop-blur border border-white/10 hover:scale-[1.01]",
  };

  return (
    <Link href={href} className={cn(base, styles[variant])}>
      {children}
      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
    </Link>
  );
};
