const base =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

const variants = {
  default:
    "bg-[#1f1f1f] text-[#f7f2ea] hover:bg-black shadow-[0_10px_30px_rgba(0,0,0,0.25)] focus-visible:ring-[#1f1f1f]",
  outline:
    "border border-[#d8d0c1] bg-white text-[#1f1f1f] hover:bg-[#f7f2ea] focus-visible:ring-[#a3472f]",
  ghost: "text-[#1f1f1f] hover:bg-[#efe8da] focus-visible:ring-[#a3472f]"
};

const sizes = {
  default: "h-10 px-5",
  lg: "h-11 px-6 text-base",
  sm: "h-9 px-4"
};

export function buttonClasses({ variant = "default", size = "default", className = "" } = {}) {
  return [base, variants[variant] ?? variants.default, sizes[size] ?? sizes.default, className]
    .filter(Boolean)
    .join(" ");
}

export function Button({ variant = "default", size = "default", className = "", ...props }) {
  return <button className={buttonClasses({ variant, size, className })} {...props} />;
}
