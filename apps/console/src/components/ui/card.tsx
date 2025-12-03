import { cn } from "./atoms";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/5 backdrop-blur shadow-[0_18px_50px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: React.ReactNode }) {
  return <div className="px-5 pt-5">{children}</div>;
}

export function CardContent({ children }: { children: React.ReactNode }) {
  return <div className="px-5 pb-5">{children}</div>;
}
