const links = [
  { href: "/#platform", label: "Platform" },
  { href: "/#workflow", label: "Workflow" },
  { href: "/#developers", label: "Developers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" }
];

export default function SiteNav() {
  return (
    <header className="site-nav-wrap">
      <nav className="site-nav" aria-label="Primary">
        <a href="/" className="brand-mark" aria-label="Settld home">
          <span className="brand-mark-core">Settld</span>
          <span className="brand-mark-sub">Economic rails for autonomous agents</span>
        </a>
        <ul className="site-links">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
        <div className="site-nav-cta">
          <a className="btn btn-ghost" href="/demo">
            Interactive demo
          </a>
          <a className="btn btn-solid" href="/#developers">
            Start integration
          </a>
        </div>
      </nav>
    </header>
  );
}
