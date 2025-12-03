import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Badge = ({ 
  children, 
  color = "signal" 
}: { 
  children?: React.ReactNode; 
  color?: "signal" | "execute" | "settle" 
}) => {
  const colors = {
    signal: "text-signal border-signal/30 bg-signal/10 shadow-[0_0_15px_rgba(0,240,255,0.2)]",
    execute: "text-execute border-execute/30 bg-execute/10 shadow-[0_0_15px_rgba(112,0,255,0.2)]",
    settle: "text-settle border-settle/30 bg-settle/10 shadow-[0_0_15px_rgba(0,255,148,0.2)]",
  };

  return (
    <span className={cn("px-3 py-1 text-[10px] uppercase tracking-wider font-mono rounded-full border backdrop-blur-md", colors[color])}>
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
  children?: React.ReactNode; 
  variant?: "primary" | "secondary" 
}) => {
  const base = "inline-flex items-center gap-3 px-8 py-4 text-sm font-semibold tracking-wide transition-all duration-300 rounded-none border group relative overflow-hidden uppercase font-mono";
  
  const styles = {
    primary: "border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-signal/50 hover:shadow-[0_0_30px_rgba(0,240,255,0.15)] backdrop-blur-xl shadow-inner",
    secondary: "border-transparent text-secondary hover:text-white hover:bg-white/5",
  };

  // Internal glowing beam effect for primary button
  const Beam = () => (
    <div className="absolute inset-0 -translate-x-[150%] group-hover:translate-x-[150%] transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12" />
  );

  const isExternal = href.startsWith("http");

  const content = (
    <>
      <span className="relative z-10 flex items-center gap-3">
        {children}
      </span>
      {variant === 'primary' && <Beam />}
    </>
  );

  if (isExternal) {
     return (
        <a href={href} className={cn(base, styles[variant])} target="_blank" rel="noopener noreferrer">
            {content}
        </a>
     )
  }

  return (
    <Link to={href} className={cn(base, styles[variant])}>
      {content}
    </Link>
  );
};