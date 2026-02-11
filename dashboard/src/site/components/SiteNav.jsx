const links = [
  { href: "/kernel-v0/", label: "Kernel v0" },
  { href: "#product", label: "Product" },
  { href: "#developers", label: "Developers" },
  { href: "#protocol", label: "Protocol" },
  { href: "#pricing", label: "Pricing" },
  { href: "#changelog", label: "Changelog" },
  { href: "#blog", label: "Blog" },
  { href: "#security", label: "Security" },
];

export default function SiteNav() {
  return (
    <header className="site-nav-wrap">
      <nav className="site-nav" aria-label="Primary">
        <a href="#top" className="brand-mark" id="top">
          <span className="brand-mark-core">SETTLD</span>
        </a>
        <ul className="site-links">
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
        <div className="site-nav-cta">
          <a className="btn btn-ghost" href="https://app.settld.work/login">
            Log in
          </a>
          <a className="btn btn-solid" href="#quickstart">
            Start building
          </a>
        </div>
      </nav>
    </header>
  );
}
