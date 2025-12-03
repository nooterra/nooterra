"use client";

import Link from "next/link";
import { cn } from "./atoms";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/docs", label: "Docs" },
  { href: "/demos/coldchain", label: "Demos" },
  { href: "/resources", label: "Resources" },
  { href: "/blog", label: "Blog" },
  { href: "https://github.com/nooterra", label: "GitHub", external: true },
];

export function GlassNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed top-4 inset-x-0 z-50 flex justify-center">
      <div className="glass-panel border border-white/10 backdrop-blur-xl bg-white/5 rounded-full px-4 py-2 shadow-[0_20px_60px_rgba(0,0,0,0.35)] flex items-center gap-2">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const content = (
            <span
              className={cn(
                "px-3 py-1 text-sm rounded-full transition-colors",
                active ? "bg-white/10 text-primary" : "text-tertiary hover:text-primary"
              )}
            >
              {item.label}
            </span>
          );
          return item.external ? (
            <a key={item.href} href={item.href} className="no-underline" target="_blank" rel="noreferrer">
              {content}
            </a>
          ) : (
            <Link key={item.href} href={item.href} className="no-underline">
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
