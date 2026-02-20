export function Card({ className = "", as: Tag = "article", ...props }) {
  return (
    <Tag
      className={[
        "rounded-2xl border border-[#d8d0c1] bg-[rgba(255,253,248,0.92)] p-6 shadow-[0_8px_24px_rgba(60,44,21,0.08)]",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}
