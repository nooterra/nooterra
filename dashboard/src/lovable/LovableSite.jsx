import { useEffect, useRef, useState, useCallback } from "react";
import { ossLinks } from "../site/config/links.js";

/* ── External links ── */
const DOCS_EXTERNAL = "https://docs.nooterra.ai";
const DOCS_GETTING_STARTED = "https://docs.nooterra.ai/quickstart";
const DISCORD_HREF = "https://discord.gg/nooterra";
const MANAGED_ONBOARDING_HREF = "/signup?experience=app";

/* ── GitHub icon ── */
function GitHubIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" {...props}>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

/* ── Integration logos (SVG) ── */
function IntegrationLogo({ name }) {
  const style = { height: 22, opacity: 0.45, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, color: "var(--text-100)" };
  const textStyle = { fontSize: "0.9375rem", fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap" };
  const logos = {
    OpenAI: <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M22.28 9.37a5.88 5.88 0 0 0-.51-4.85 5.96 5.96 0 0 0-6.42-2.86A5.88 5.88 0 0 0 10.93 0a5.96 5.96 0 0 0-5.68 4.11 5.88 5.88 0 0 0-3.93 2.84 5.96 5.96 0 0 0 .73 6.98 5.88 5.88 0 0 0 .51 4.85 5.96 5.96 0 0 0 6.42 2.86A5.88 5.88 0 0 0 13.4 24a5.96 5.96 0 0 0 5.68-4.11 5.88 5.88 0 0 0 3.93-2.84 5.96 5.96 0 0 0-.73-6.98v-.7zM13.4 22.24a4.42 4.42 0 0 1-2.83-1.02l.14-.08 4.7-2.71a.76.76 0 0 0 .39-.67v-6.62l1.99 1.15a.07.07 0 0 1 .04.05v5.49a4.46 4.46 0 0 1-4.43 4.41zm-9.53-4.06a4.42 4.42 0 0 1-.53-2.97l.14.08 4.7 2.71a.76.76 0 0 0 .77 0l5.74-3.31v2.3a.07.07 0 0 1-.03.06l-4.75 2.74a4.46 4.46 0 0 1-6.04-1.61zM2.62 7.88A4.42 4.42 0 0 1 4.94 6l-.02.16v5.43a.76.76 0 0 0 .38.66l5.74 3.31-1.99 1.15a.07.07 0 0 1-.07 0L4.23 14a4.46 4.46 0 0 1-1.61-6.12zm16.36 3.8l-5.74-3.31 1.99-1.15a.07.07 0 0 1 .07 0l4.75 2.74a4.46 4.46 0 0 1-.69 8.05v-5.6a.76.76 0 0 0-.38-.66v-.07zM20.96 9a4.56 4.56 0 0 0-.14-.08l-4.7-2.71a.76.76 0 0 0-.77 0L9.6 9.54v-2.3a.07.07 0 0 1 .03-.06L14.38 4.44A4.46 4.46 0 0 1 20.96 9zM8.5 13.27L6.51 12.12a.07.07 0 0 1-.04-.05V6.58a4.46 4.46 0 0 1 7.26-3.39l-.14.08-4.7 2.71a.76.76 0 0 0-.39.67v6.62zm1.08-2.33l2.56-1.47 2.56 1.47v2.95l-2.56 1.47-2.56-1.47v-2.95z"/></svg>,
    Anthropic: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13.83 2H16.9l6.1 20h-3.07l-1.52-5.2H12.3l3.07-3.07h4.6L16.36 2.87 13.83 2zM7.1 2L1 22h3.07l1.52-5.2h6.11L8.63 13.73H4.05L7.1 2z"/></svg>,
    Google: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>,
    Stripe: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M13.98 11.57c0-1.59-.77-2.84-2.24-2.84s-2.37 1.25-2.37 2.83c0 1.87 1.05 2.81 2.56 2.81.74 0 1.29-.17 1.71-.4v-1.39c-.42.22-.9.35-1.51.35-.6 0-1.13-.21-1.2-.93h3.02c.02-.08.03-.4.03-.43zm-3.06-.59c0-.69.42-1 .81-1s.77.31.77 1h-1.58zM8.13 8.73c-.6 0-1 .28-1.21.48l-.08-.38H5.4v7.7l1.62-.34.01-1.87c.22.16.54.39 1.08.39 1.09 0 2.08-.88 2.08-2.81 0-1.77-1.01-2.73-2.06-2.73v-.44zm-.36 4.2c-.36 0-.57-.13-.72-.29l-.01-2.28c.16-.18.37-.31.73-.31.56 0 .94.62.94 1.44 0 .83-.37 1.44-.94 1.44zM4.09 8.37l1.63-.35V6.7L4.09 7.05v1.32zM5.72 8.85H4.09v5.83h1.63V8.85zM18.6 10.56l.01-1.71h-1.62v5.83h1.62v-3.91c.38-.5 1.03-.41 1.23-.34V8.85c-.21-.08-.97-.23-1.24.27v1.44zm2.57-1.71h-1.62v5.83h1.62V8.85zM21.78 7.05l-1.62.34v1.46h1.62V7.05z"/></svg>,
    Slack: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M5.04 15.28a2.18 2.18 0 0 1-2.18 2.18A2.18 2.18 0 0 1 .68 15.28a2.18 2.18 0 0 1 2.18-2.18h2.18v2.18zm1.09 0a2.18 2.18 0 0 1 2.18-2.18 2.18 2.18 0 0 1 2.18 2.18v5.45a2.18 2.18 0 0 1-2.18 2.18 2.18 2.18 0 0 1-2.18-2.18v-5.45z" fill="#E01E5A"/><path d="M8.31 5.04a2.18 2.18 0 0 1-2.18-2.18A2.18 2.18 0 0 1 8.31.68a2.18 2.18 0 0 1 2.18 2.18v2.18H8.31zm0 1.1a2.18 2.18 0 0 1 2.18 2.18 2.18 2.18 0 0 1-2.18 2.18H2.86A2.18 2.18 0 0 1 .68 8.32 2.18 2.18 0 0 1 2.86 6.14h5.45z" fill="#36C5F0"/><path d="M18.96 8.32a2.18 2.18 0 0 1 2.18-2.18 2.18 2.18 0 0 1 2.18 2.18 2.18 2.18 0 0 1-2.18 2.18h-2.18V8.32zm-1.09 0a2.18 2.18 0 0 1-2.18 2.18 2.18 2.18 0 0 1-2.18-2.18V2.86A2.18 2.18 0 0 1 15.69.68a2.18 2.18 0 0 1 2.18 2.18v5.46z" fill="#2EB67D"/><path d="M15.69 18.96a2.18 2.18 0 0 1 2.18 2.18 2.18 2.18 0 0 1-2.18 2.18 2.18 2.18 0 0 1-2.18-2.18v-2.18h2.18zm0-1.09a2.18 2.18 0 0 1-2.18-2.18 2.18 2.18 0 0 1 2.18-2.18h5.45a2.18 2.18 0 0 1 2.18 2.18 2.18 2.18 0 0 1-2.18 2.18h-5.45z" fill="#ECB22E"/></svg>,
    GitHub: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>,
    Gmail: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/></svg>,
    Notion: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.46 2.16l12.7-.93c1.56-.13 1.96-.04 2.94.66l4.05 2.83c.67.47.89.6.89 1.12v14.48c0 .88-.32 1.4-1.47 1.48l-15.17.89c-.86.05-1.28-.09-1.74-.65L2.72 17.5c-.51-.65-.73-1.14-.73-1.71V3.56c0-.72.32-1.31 1.47-1.4zm13.26 2.65c.18.14.22.18.22.4v11.46c0 .36-.14.54-.45.56l-11.3.65c-.31.02-.46-.08-.6-.26l-2.63-3.44c-.18-.23-.26-.4-.26-.63V3.6c0-.28.09-.46.36-.49l13.92-.81c.05 0 .13.04.18.08l.56.43z"/></svg>,
    Linear: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.77 17.72a11.94 11.94 0 0 1-1.42-3.13L12.59 3.35a11.93 11.93 0 0 1 3.13 1.42L2.77 17.72zm-1.93-5.48A12.04 12.04 0 0 1 12 0c.75 0 1.49.07 2.2.2L.97 13.44a12.11 12.11 0 0 1-.13-1.2zm1.25 7.54l15.28-15.28c.55.45 1.06.96 1.51 1.51L3.6 21.29a12.02 12.02 0 0 1-1.51-1.51zm3.54 2.83l13.02-13.02a11.94 11.94 0 0 1 1.42 3.13L8.83 23.96a11.93 11.93 0 0 1-3.2-1.35zm5.93 1.27L23.88 11.56c.08.48.12.97.12 1.47A12.04 12.04 0 0 1 12 24.97c-.48 0-.97-.04-1.44-.12z"/></svg>,
    Vercel: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L24 22H0L12 1z"/></svg>,
  };
  return (
    <div style={style}>
      {logos[name]}
      <span style={textStyle}>{name}</span>
    </div>
  );
}

/* ── Intersection Observer fade-in ── */
function InView({ children, delay = 0, className = "", as: Tag = "div", style }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add("visible"); obs.unobserve(el); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={`fade-up ${className}`} style={{ transitionDelay: `${delay}s`, ...style }}>
      {children}
    </Tag>
  );
}

/* ── Legacy FadeIn for compatibility ── */
function FadeIn({ children, delay = 0 }) {
  return (
    <div className="lovable-fade" style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

/* ── Shared nav ── */
function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navStyle = {
    position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
    borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
    backgroundColor: scrolled ? "rgba(250,249,246,0.85)" : "transparent",
    backdropFilter: scrolled ? "blur(12px)" : "none",
    transition: "all 300ms ease",
  };

  const linkStyle = {
    fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-200)",
    textDecoration: "none", transition: "color 150ms",
  };

  return (
    <nav style={navStyle}>
      <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <a href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center" }}>
          <img src="/nooterra-logo.png" alt="nooterra" style={{ height: 22 }} />
        </a>

        {/* Desktop links */}
        <div style={{ alignItems: "center", gap: 28 }} className="nav-desktop">
          <a href="/pricing" style={linkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-200)"}>Pricing</a>
          <a href={DOCS_EXTERNAL} style={linkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-200)"}>Docs</a>
          <a href={ossLinks.repo} style={linkStyle} target="_blank" rel="noopener noreferrer" onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-200)"}>GitHub</a>
          <a href="/login" style={linkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-200)"}>Sign in</a>
          <a href="/signup" style={{
            display: "inline-flex", alignItems: "center", padding: "7px 18px",
            fontSize: "0.8125rem", fontWeight: 600, backgroundColor: "var(--text-100)", color: "var(--bg-100)",
            borderRadius: 8, textDecoration: "none", transition: "opacity 150ms",
          }} onMouseEnter={e => e.currentTarget.style.opacity = "0.85"} onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
            Get started
          </a>
        </div>

        {/* Mobile hamburger */}
        <button onClick={() => setMobileOpen(!mobileOpen)} className="nav-mobile-btn" aria-label="Toggle menu" style={{ background: "none", border: "none", cursor: "pointer", padding: 12, color: "var(--text-100)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="nav-mobile-menu" style={{ padding: "8px 24px 20px", borderTop: "1px solid var(--border)", backgroundColor: "var(--bg-100)", flexDirection: "column", gap: 16 }}>
          <a href="/pricing" style={linkStyle}>Pricing</a>
          <a href={DOCS_EXTERNAL} style={linkStyle}>Docs</a>
          <a href={ossLinks.repo} style={linkStyle} target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="/login" style={linkStyle}>Sign in</a>
          <a href="/signup" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "10px 20px", fontSize: "0.875rem", fontWeight: 600, backgroundColor: "var(--text-100)", color: "var(--bg-100)", borderRadius: 8, textDecoration: "none" }}>Get started</a>
        </div>
      )}
    </nav>
  );
}

/* ── Footer ── */
function SiteFooter() {
  const footerLinkStyle = { fontSize: "0.8125rem", color: "var(--text-300)", textDecoration: "none", transition: "color 150ms", display: "block", lineHeight: 2.2 };
  return (
    <footer style={{ borderTop: "1px solid var(--border)", backgroundColor: "var(--bg-200)" }}>
      <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "32px 24px 24px" }}>
        <div className="footer-grid" style={{ marginBottom: 32 }}>
          <div>
            <div style={{ marginBottom: 16 }}>
              <img src="/nooterra-logo.png" alt="nooterra" loading="lazy" style={{ height: 20 }} />
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-300)", lineHeight: 1.6, maxWidth: 260, margin: 0 }}>
              The AI workforce platform for consequential work. Open source.
            </p>
          </div>
          <div>
            <p style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-300)", marginBottom: 12 }}>Product</p>
            <a href="/pricing" style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"}>Pricing</a>
            <a href={DOCS_EXTERNAL} style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"} target="_blank" rel="noopener noreferrer">Documentation</a>
            <a href="/security" style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"}>Security</a>
            <a href="/status" style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"}>Status</a>
            <a href="/changelog" style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"}>Changelog</a>
          </div>
          <div>
            <p style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-300)", marginBottom: 12 }}>Community</p>
            <a href={ossLinks.repo} style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"} target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href={DISCORD_HREF} style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"} target="_blank" rel="noopener noreferrer">Discord</a>
            <a href={ossLinks.issues} style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"} target="_blank" rel="noopener noreferrer">Issues</a>
          </div>
          <div>
            <p style={{ fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-300)", marginBottom: 12 }}>Legal</p>
            <a href="/privacy" style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"}>Privacy</a>
            <a href="/terms" style={footerLinkStyle} onMouseEnter={e => e.currentTarget.style.color = "var(--text-100)"} onMouseLeave={e => e.currentTarget.style.color = "var(--text-300)"}>Terms</a>
          </div>
        </div>
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-300)" }}>&copy; {new Date().getFullYear()} Nooterra</span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-300)" }}>Open source under Apache 2.0</span>
        </div>
      </div>
    </footer>
  );
}

function SiteLayout({ children }) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-100)", color: "var(--text-100)" }}>
      <a href="#site-content" style={{ position: "absolute", top: -40, left: 0, background: "var(--accent)", color: "#fff", padding: "8px 16px", zIndex: 1000, fontSize: "14px", fontWeight: 600, borderRadius: "0 0 8px 0", transition: "top 150ms", textDecoration: "none" }} onFocus={e => { e.currentTarget.style.top = "0"; }} onBlur={e => { e.currentTarget.style.top = "-40px"; }}>Skip to content</a>
      <SiteNav />
      <main id="site-content" style={{ paddingTop: 56 }}>{children}</main>
      <SiteFooter />
    </div>
  );
}

/* ── Animated worker card ── */

const WORKER_STEPS = [
  { label: "Read customer email", status: "done" },
  { label: "Look up account in Stripe", status: "done" },
  { label: "Draft refund reply", status: "done" },
  { label: "Issue $49 refund", status: "approval" },
];

function WorkerCard() {
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (step >= WORKER_STEPS.length) return;
    const delay = step === 0 ? 800 : WORKER_STEPS[step].status === "approval" ? 1200 : 700;
    const timer = setTimeout(() => setStep(s => s + 1), delay);
    return () => clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (step >= WORKER_STEPS.length && !approved) {
      const timer = setTimeout(() => setApproved(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [step, approved]);

  const Check = ({ color }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  return (
    <div style={{
      border: "1px solid var(--border)",
      borderLeft: "3px solid var(--accent)",
      borderRadius: 16,
      backgroundColor: "var(--bg-400)",
      overflow: "hidden",
      boxShadow: "var(--shadow-xl)",
      maxWidth: 440,
      transform: "rotate(2deg)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--bg-200)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="lovable-pulse" style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--green)" }} />
          <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-100)" }}>Customer Support Worker</span>
        </div>
        <span className="tabular-nums" style={{ fontSize: "0.6875rem", color: "var(--text-300)", fontFamily: "var(--font-mono)" }}>running</span>
      </div>

      {/* Steps */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {WORKER_STEPS.slice(0, step).map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, animation: "lovable-fade-in 0.3s ease forwards" }}>
            {s.status === "done" ? <Check color="var(--green)" />
              : approved ? <Check color="var(--accent)" />
              : <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--amber)", flexShrink: 0 }} className="lovable-pulse" />
            }
            <span style={{ fontSize: "0.8125rem", color: s.status === "approval" && !approved ? "var(--amber)" : "var(--text-200)" }}>
              {s.label}
            </span>
            {s.status === "approval" && !approved && (
              <span style={{ marginLeft: "auto", padding: "2px 8px", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, borderRadius: 6, backgroundColor: "var(--amber-bg)", color: "var(--amber)", fontFamily: "var(--font-mono)" }}>
                needs approval
              </span>
            )}
            {s.status === "approval" && approved && (
              <span style={{ marginLeft: "auto", padding: "2px 8px", fontSize: "0.625rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, borderRadius: 6, backgroundColor: "var(--green-bg)", color: "var(--green)", fontFamily: "var(--font-mono)" }}>
                approved
              </span>
            )}
          </div>
        ))}
        {step < WORKER_STEPS.length && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="lovable-pulse" style={{ width: 14, height: 14, borderRadius: "50%", border: "1px solid var(--border)", flexShrink: 0 }} />
            <span style={{ fontSize: "0.8125rem", color: "var(--text-300)" }}>Working...</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 20px", borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 16, backgroundColor: "var(--bg-200)" }}>
        <span className="tabular-nums" style={{ fontSize: "0.6875rem", color: "var(--green)", fontFamily: "var(--font-mono)" }}>4 canDo</span>
        <span className="tabular-nums" style={{ fontSize: "0.6875rem", color: "var(--amber)", fontFamily: "var(--font-mono)" }}>3 askFirst</span>
        <span className="tabular-nums" style={{ fontSize: "0.6875rem", color: "var(--red)", fontFamily: "var(--font-mono)" }}>2 neverDo</span>
        <span className="tabular-nums" style={{ fontSize: "0.6875rem", color: "var(--text-300)", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>$0.003 this run</span>
      </div>
    </div>
  );
}

/* ── HOME PAGE ── */

function HomePage() {
  return (
    <SiteLayout>
      {/* ═══ HERO ═══ */}
      <section style={{ position: "relative", overflow: "hidden" }}>
        {/* Dot grid background */}
        <div className="dot-grid" style={{ position: "absolute", inset: 0, opacity: 0.5 }} />
        {/* Gradient fade at bottom */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 120, background: "linear-gradient(to top, var(--bg-100), transparent)", zIndex: 1 }} />

        <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "0 24px", paddingTop: "clamp(4rem, 12vh, 10rem)", paddingBottom: "clamp(3rem, 8vh, 6rem)", position: "relative", zIndex: 2 }}>
          <div className="hero-grid">
            <div>
              <InView>
                <h1 style={{
                  fontSize: "var(--text-display)", lineHeight: 1.04, letterSpacing: "-0.04em",
                  fontWeight: 800, color: "var(--text-100)", margin: 0,
                }}>
                  <span style={{ textDecoration: "underline", textDecorationColor: "var(--accent)", textUnderlineOffset: "0.1em", textDecorationThickness: "0.08em" }}>Hire AI.</span>
                </h1>
              </InView>
              <InView delay={0.1}>
                <p style={{
                  marginTop: 28, maxWidth: 460,
                  fontSize: "var(--text-sm)", lineHeight: 1.7, color: "var(--text-300)",
                }}>
                  Describe your business. Get a team of AI workers that handle emails, schedule appointments, and manage your reputation&mdash;while you do the real work.
                </p>
              </InView>
              <InView delay={0.15}>
                <div style={{ marginTop: 36, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                  <a href="/signup" style={{
                    display: "inline-flex", alignItems: "center", padding: "14px 36px",
                    fontSize: "var(--text-base)", fontWeight: 600,
                    backgroundColor: "var(--text-100)", color: "var(--bg-100)", borderRadius: 10,
                    textDecoration: "none", transition: "transform 150ms, box-shadow 150ms",
                    boxShadow: "var(--shadow-md)",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--shadow-lg)"; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
                  >
                    Start hiring &rarr;
                  </a>
                  <a href={ossLinks.repo} style={{
                    display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 36px",
                    fontSize: "var(--text-base)", fontWeight: 500,
                    border: "1px solid var(--border-strong)", color: "var(--text-100)", borderRadius: 10,
                    textDecoration: "none", transition: "border-color 150ms, background 150ms",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-300)"; e.currentTarget.style.backgroundColor = "var(--bg-200)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                    target="_blank" rel="noopener noreferrer"
                  >
                    <GitHubIcon /> View source
                  </a>
                </div>
              </InView>
            </div>

            <InView delay={0.2}>
              <div>
                <WorkerCard />
              </div>
            </InView>
          </div>
        </div>
      </section>

      {/* ═══ INTEGRATIONS MARQUEE ═══ */}
      <section>
        <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "0 24px" }}>
          <div style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "18px 0", overflow: "hidden" }}>
          <div className="logo-marquee">
            <div className="logo-marquee-track">
              {[...Array(4)].map((_, setIdx) => (
                <div key={setIdx} style={{ display: "flex", alignItems: "center", gap: 48, paddingRight: 48, flexShrink: 0 }}>
                  <IntegrationLogo name="OpenAI" />
                  <IntegrationLogo name="Anthropic" />
                  <IntegrationLogo name="Google" />
                  <IntegrationLogo name="Stripe" />
                  <IntegrationLogo name="Slack" />
                  <IntegrationLogo name="GitHub" />
                  <IntegrationLogo name="Gmail" />
                  <IntegrationLogo name="Notion" />
                  <IntegrationLogo name="Linear" />
                  <IntegrationLogo name="Vercel" />
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
      </section>

      {/* ═══ HOW IT WORKS ═══ */}
      <section>
        <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "var(--section-pad) 24px" }}>
          <InView>
            <h2 style={{ fontSize: "var(--text-2xl)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--text-100)", margin: 0, marginBottom: 16 }}>
              60 seconds to your first team.
            </h2>
            <p style={{ fontSize: "var(--text-base)", color: "var(--text-200)", maxWidth: 520, lineHeight: 1.6, marginBottom: 48 }}>
              No code. No configuration. No AI expertise.
            </p>
          </InView>

          <div className="steps-grid">
            {[
              {
                step: "01",
                title: "Tell us what you do",
                desc: "\"I run a plumbing company in Denver with 5 techs.\" That's it. We figure out the rest.",
                mono: 'nooterra.ai \u2192 team proposal appears instantly',
              },
              {
                step: "02",
                title: "Review your team",
                desc: "Reception. Dispatch. Billing. Reviews. Each worker comes with rules, integrations, and a clear job description. Adjust anything.",
                mono: "Reception \u00b7 Dispatch \u00b7 Billing \u00b7 Reviews \u00b7 Inventory",
              },
              {
                step: "03",
                title: "They get better every day",
                desc: "Workers start careful and earn autonomy. The more you approve, the more they handle. You stay in control\u2014always.",
                mono: "approval rate \u00b7 tasks completed \u00b7 cost per task \u00b7 violations",
              },
            ].map((item, i) => (
              <InView key={item.step} delay={i * 0.08} style={{ backgroundColor: "var(--bg-400)", padding: "32px 28px" }}>
                <span style={{ fontSize: "0.6875rem", fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)", marginBottom: 16, display: "block" }}>{item.step}</span>
                <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-100)", margin: "0 0 10px" }}>{item.title}</h3>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--text-200)", lineHeight: 1.65, margin: "0 0 20px" }}>{item.desc}</p>
                <code style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-300)", backgroundColor: "var(--bg-200)", padding: "4px 10px", borderRadius: 6, display: "inline-block" }}>
                  {item.mono}
                </code>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ RULES / CHARTER ═══ */}
      <section style={{ backgroundColor: "var(--bg-200)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "var(--section-pad) 24px" }}>
          <InView>
            <h2 style={{ fontSize: "var(--text-3xl)", letterSpacing: "-0.035em", fontWeight: 800, color: "var(--text-100)", margin: "0 0 16px" }}>
              Rules they can't break.
            </h2>
            <p style={{ fontSize: "var(--text-base)", color: "var(--text-200)", lineHeight: 1.6, maxWidth: 520, marginBottom: 48 }}>
              Not suggestions. Not guidelines. Hard limits enforced before every action. You set the rules. The system enforces them.
            </p>
          </InView>

          <div className="rules-grid">
            {[
              { color: "var(--green)", bg: "var(--green-bg)", label: "Handles autonomously", desc: "Actions the worker can perform autonomously. No human needed.", items: ["Read emails", "Draft replies", "Search knowledge base"] },
              { color: "var(--amber)", bg: "var(--amber-bg)", label: "Asks you first", desc: "Sensitive actions that pause for your approval before executing.", items: ["Issue refunds", "Send external emails", "Modify account data"] },
              { color: "var(--red)", bg: "var(--red-bg)", label: "Never does", desc: "Hard boundaries. These actions are blocked at runtime. Period.", items: ["Delete customer data", "Share PII externally", "Exceed budget limits"] },
            ].map((rule, i) => (
              <InView key={rule.label} delay={i * 0.08}>
                <div style={{ padding: 28, borderRadius: 14, backgroundColor: "var(--bg-400)", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: rule.color }} />
                    <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-100)", fontFamily: "var(--font-mono)" }}>{rule.label}</span>
                  </div>
                  <p style={{ fontSize: "0.8125rem", lineHeight: 1.6, color: "var(--text-200)", margin: "0 0 18px" }}>{rule.desc}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {rule.items.map(item => (
                      <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, backgroundColor: rule.bg }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: rule.color, flexShrink: 0 }} />
                        <span style={{ fontSize: "0.8125rem", color: "var(--text-100)", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ USE CASES ═══ */}
      <section>
        <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "var(--section-pad) 24px" }}>
          <InView>
            <h2 style={{ fontSize: "var(--text-2xl)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--text-100)", margin: "0 0 16px" }}>
              Any industry. Any size.
            </h2>
            <p style={{ fontSize: "var(--text-base)", color: "var(--text-200)", maxWidth: 520, lineHeight: 1.6, marginBottom: 48 }}>
              Plumbers, law firms, restaurants, e-commerce, trucking, dental, salons&mdash;if you run a business, you get a team.
            </p>
          </InView>

          <div className="use-cases-grid">
            {[
              {
                title: "Home Services",
                desc: "Reception, dispatch, billing, and reviews. For plumbers, electricians, HVAC, and contractors.",
                schedule: "5-6 workers \u00b7 Continuous",
                rules: "Connects: Email, Calendar",
              },
              {
                title: "Professional Services",
                desc: "Client intake, scheduling, document prep, and follow-ups. For law firms, accountants, and consultants.",
                schedule: "5-6 workers \u00b7 Continuous",
                rules: "Connects: Email, Calendar",
              },
              {
                title: "E-Commerce",
                desc: "Customer support, order tracking, returns, and review management. For online stores of any size.",
                schedule: "5-6 workers \u00b7 Continuous",
                rules: "Connects: Email, Calendar",
              },
            ].map((uc, i) => (
              <InView key={uc.title} delay={i * 0.08}>
                <div style={{
                  padding: 28, borderRadius: 14, border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-400)", transition: "border-color 200ms, box-shadow 200ms",
                  height: "100%", display: "flex", flexDirection: "column",
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  <h3 style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text-100)", margin: "0 0 8px" }}>{uc.title}</h3>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-200)", lineHeight: 1.6, margin: "0 0 auto", paddingBottom: 20 }}>{uc.desc}</p>
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: "0.6875rem", fontFamily: "var(--font-mono)", color: "var(--text-300)" }}>{uc.schedule}</span>
                    <span style={{ fontSize: "0.6875rem", fontFamily: "var(--font-mono)", color: "var(--text-300)" }}>{uc.rules}</span>
                  </div>
                </div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FEATURES STRIP ═══ */}
      <section style={{ backgroundColor: "var(--bg-200)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "var(--section-pad) 24px" }}>
          <InView>
            <h2 style={{ fontSize: "var(--text-2xl)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--text-100)", margin: "0 0 48px" }}>
              The fine print.
            </h2>
          </InView>

          <div className="features-grid">
            {[
              { title: "Always asks first", desc: "Risky actions pause and ask you. Refunds, schedule changes, anything that matters \u2014 you stay in control." },
              { title: "Earns your trust", desc: "Every worker starts careful. As you approve more actions, it learns what's safe and handles more on its own." },
              { title: "Works around the clock", desc: "Your workers don't take breaks, don't call in sick, and don't forget. 24/7, every day." },
              { title: "Pennies per task", desc: "Most tasks cost less than a penny. See exactly what each worker costs. No surprise bills." },
              { title: "Connects to your tools", desc: "Gmail, Google Calendar, Slack \u2014 with more integrations coming soon." },
              { title: "You own everything", desc: "Full audit trail. Export anytime. Cancel and your data is deleted. Open source." },
            ].map((feat, i) => (
              <InView key={feat.title} delay={i * 0.05}>
                <div style={{ padding: "24px 0", borderBottom: "1px solid var(--border)" }}>
                  <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-100)", margin: "0 0 6px" }}>{feat.title}</h3>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--text-200)", lineHeight: 1.65, margin: 0, maxWidth: 420 }}>{feat.desc}</p>
                </div>
              </InView>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "80%", height: "80%", background: "radial-gradient(ellipse at center, var(--accent-subtle) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "clamp(6rem, 14vh, 11rem) 24px", textAlign: "center", position: "relative", zIndex: 1 }}>
          <InView>
            <h2 style={{
              fontSize: "var(--text-display)", letterSpacing: "-0.04em", fontWeight: 800,
              color: "var(--text-100)", margin: "0 0 20px",
            }}>
              Your team is waiting.
            </h2>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-300)", maxWidth: 440, margin: "0 auto 40px", lineHeight: 1.7 }}>
              60 seconds from now, you could have an AI team handling the work you don't have time for.
            </p>
          </InView>
          <InView delay={0.08}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
              <a href="/signup" style={{
                display: "inline-flex", alignItems: "center", padding: "16px 40px",
                fontSize: "var(--text-base)", fontWeight: 600,
                backgroundColor: "var(--text-100)", color: "var(--bg-100)", borderRadius: 10,
                textDecoration: "none", transition: "transform 150ms, box-shadow 150ms",
                boxShadow: "var(--shadow-md)",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--shadow-lg)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
              >
                Start hiring &rarr;
              </a>
              <a href={DOCS_GETTING_STARTED} style={{
                display: "inline-flex", alignItems: "center", padding: "16px 40px",
                fontSize: "var(--text-base)", fontWeight: 500,
                border: "1px solid var(--border-strong)", color: "var(--text-100)", borderRadius: 10,
                textDecoration: "none", transition: "border-color 150ms, background 150ms",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--text-300)"; e.currentTarget.style.backgroundColor = "var(--bg-200)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.backgroundColor = "transparent"; }}
                target="_blank" rel="noopener noreferrer"
              >
                See how it works
              </a>
            </div>
          </InView>
        </div>
      </section>
    </SiteLayout>
  );
}

/* ── SECURITY PAGE ── */

function SecurityPage() {
  return (
    <SiteLayout>
      <section style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "7rem 24px 3rem" }}>
        <FadeIn>
          <h1 style={{ fontSize: "var(--text-2xl)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--text-100)" }}>Security</h1>
          <p style={{ marginTop: 20, maxWidth: 520, fontSize: "var(--text-base)", lineHeight: 1.6, color: "var(--text-200)" }}>
            Workers cannot exceed their charter. Every action is logged. Every escalation requires human approval. Every boundary is enforced at runtime.
          </p>
        </FadeIn>
      </section>
      <section style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "0 24px 6rem" }}>
        <div style={{ marginTop: 40 }}>
          {[
            { title: "Fail closed", desc: "Ambiguous situations halt execution and ask. Missing context, unclear scope, or expired approvals all stop the worker." },
            { title: "Least privilege", desc: "Workers only access tools and data explicitly granted in their charter. Nothing more." },
            { title: "Human in the loop", desc: "Consequential actions always route through human approval. The threshold is configurable per worker." },
            { title: "Full audit trail", desc: "Every action, approval, and decision logged with timestamps and context. Export anytime." },
          ].map((item, i) => (
            <FadeIn key={item.title} delay={i * 0.06}>
              <div style={{ padding: "32px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-100)" }}>{item.title}</h3>
                <p style={{ marginTop: 8, maxWidth: 520, fontSize: "var(--text-sm)", lineHeight: 1.6, color: "var(--text-200)" }}>{item.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
        <div style={{ marginTop: 48, paddingTop: 48, borderTop: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-100)", marginBottom: 20 }}>Infrastructure & compliance</h3>
          {[
            { label: "Encryption", desc: "All data encrypted in transit (TLS 1.3) and at rest (AES-256). API keys are encrypted with per-tenant keys." },
            { label: "Hosting", desc: "Deployed on Railway with automatic SSL. No data leaves your configured region." },
            { label: "Access control", desc: "Role-based access with per-worker permission scoping. OAuth tokens are scoped to minimum required permissions." },
            { label: "Incident response", desc: "Automated alerting with manual escalation. Security issues can be reported to security@nooterra.ai." },
          ].map((item, i) => (
            <div key={i} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-100)", marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-200)", lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}

/* ── SIMPLE PAGES ── */

function SimplePage({ title, children }) {
  return (
    <SiteLayout>
      <section style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "7rem 24px 3rem" }}>
        <FadeIn>
          <h1 style={{ fontSize: "var(--text-2xl)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--text-100)" }}>{title}</h1>
        </FadeIn>
      </section>
      <section style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "0 24px 6rem" }}>
        <FadeIn delay={0.06}>{children}</FadeIn>
      </section>
    </SiteLayout>
  );
}

function PrivacyPage() {
  return (
    <SimplePage title="Privacy">
      <div>
        {[
          { title: "Your keys, your providers", desc: "API keys are encrypted at rest and never leave your account boundary. Free tier runs entirely on your machine." },
          { title: "No training on your data", desc: "We never train models on your data. Audit logs are yours\u2014exportable and deletable." },
          { title: "Data portability", desc: "Export workers, charters, and logs at any time. Cancel and your data is deleted within 30 days." },
        ].map((item, i) => (
          <div key={item.title} style={{ padding: "32px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
            <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-100)" }}>{item.title}</h3>
            <p style={{ marginTop: 8, maxWidth: 520, fontSize: "var(--text-sm)", lineHeight: 1.6, color: "var(--text-200)" }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </SimplePage>
  );
}

function TermsPage() {
  return (
    <SimplePage title="Terms">
      <div>
        {[
          { title: "Your workers, your responsibility", desc: "You define the charter, grant approvals, and control what workers do. Nooterra enforces the boundaries you set." },
          { title: "Fair use", desc: "Workers should perform legitimate business tasks. Do not use for spam, fraud, or harassment." },
          { title: "Service availability", desc: "Free tier runs locally with no uptime guarantee. Paid tiers include SLAs." },
        ].map((item, i) => (
          <div key={item.title} style={{ padding: "32px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
            <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-100)" }}>{item.title}</h3>
            <p style={{ marginTop: 8, maxWidth: 520, fontSize: "var(--text-sm)", lineHeight: 1.6, color: "var(--text-200)" }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </SimplePage>
  );
}

function SupportPage() {
  return (
    <SimplePage title="Get help">
      <div>
        {[
          { title: "Documentation", desc: "Guides, API reference, and troubleshooting.", href: DOCS_EXTERNAL, cta: "Open docs" },
          { title: "Discord", desc: "Ask questions and get help from the community.", href: DISCORD_HREF, cta: "Join Discord" },
          { title: "GitHub Issues", desc: "Report bugs or request features.", href: ossLinks.issues, cta: "Open issue" },
        ].map((item, i) => (
          <a key={item.title} href={item.href} style={{ display: "block", padding: "32px 0", textDecoration: "none", borderTop: i > 0 ? "1px solid var(--border)" : "none" }} target="_blank" rel="noopener noreferrer">
            <h3 style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-100)" }}>{item.title}</h3>
            <p style={{ marginTop: 8, fontSize: "var(--text-sm)", lineHeight: 1.6, color: "var(--text-200)" }}>{item.desc}</p>
            <span style={{ marginTop: 8, display: "inline-block", fontSize: "var(--text-sm)", color: "var(--accent)" }}>{item.cta} &rarr;</span>
          </a>
        ))}
      </div>
    </SimplePage>
  );
}

/* ── STATUS PAGE ── */

const PUBLIC_STATUS_CHECKS = Object.freeze([
  { id: "home", label: "Homepage", path: "/", type: "html", needle: "conversation" },
]);

function normalizeStatusPathname(value) {
  if (typeof window === "undefined") return "";
  try { return new URL(String(value ?? "/"), window.location.origin).pathname || "/"; } catch { return ""; }
}

async function probePublicHtmlRoute(check, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  if (typeof window === "undefined" || !window.document?.body) {
    return { ...check, status: "unavailable", statusLabel: "Unavailable", detail: "Requires browser" };
  }
  return new Promise((resolve) => {
    const iframe = window.document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    Object.assign(iframe.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", border: "0" });
    const expectedPathname = normalizeStatusPathname(check.path);
    let settled = false, intervalId = null, timeoutId = null, lastState = {};
    const cleanup = () => { if (intervalId) clearInterval(intervalId); if (timeoutId) clearTimeout(timeoutId); iframe.remove(); };
    const finish = (result) => { if (settled) return; settled = true; cleanup(); resolve({ ...check, ...result }); };
    const readState = () => {
      try {
        const fd = iframe.contentDocument;
        lastState = { pathname: iframe.contentWindow?.location?.pathname ?? "", text: fd?.body?.innerText ?? "", ready: fd?.readyState ?? "" };
        if (lastState.ready === "complete" && (!expectedPathname || lastState.pathname === expectedPathname) && (!check.needle || lastState.text.includes(check.needle))) {
          finish({ status: "ok", statusLabel: "Operational" });
        }
      } catch (e) { finish({ status: "unavailable", statusLabel: "Unavailable" }); }
    };
    iframe.addEventListener("load", () => { readState(); if (!settled) intervalId = setInterval(readState, intervalMs); });
    timeoutId = setTimeout(() => finish({ status: "degraded", statusLabel: "Degraded" }), timeoutMs);
    document.body.append(iframe);
    iframe.src = check.path;
  });
}

function StatusPage() {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ loading: true, checks: [] });

  useEffect(() => {
    let c = false;
    (async () => {
      setState(p => ({ ...p, loading: true }));
      const checks = await Promise.all(PUBLIC_STATUS_CHECKS.map(probePublicHtmlRoute));
      if (!c) setState({ loading: false, checks, at: new Date().toISOString() });
    })();
    return () => { c = true; };
  }, [nonce]);

  const allOk = state.checks.every(c => c.status === "ok");

  return (
    <SimplePage title="Status">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px",
          fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600,
          borderRadius: 8, fontFamily: "var(--font-mono)",
          backgroundColor: state.loading ? "var(--bg-200)" : allOk ? "var(--green-bg)" : "var(--amber-bg)",
          color: state.loading ? "var(--text-300)" : allOk ? "var(--green)" : "var(--amber)",
        }}>
          {state.loading ? "Checking..." : allOk ? "All systems operational" : "Degraded"}
        </span>
        <button onClick={() => setNonce(v => v + 1)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-300)", padding: 4, transition: "color 150ms" }}
          onMouseEnter={(e) => e.currentTarget.style.color = "var(--text-200)"}
          onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-300)"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
      </div>
      <div>
        {state.checks.map((c, i) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-100)" }}>{c.label}</span>
            <span style={{ fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, fontFamily: "var(--font-mono)", color: c.status === "ok" ? "var(--green)" : c.status === "degraded" ? "var(--amber)" : "var(--red)" }}>
              {c.statusLabel}
            </span>
          </div>
        ))}
      </div>
      {state.at && <p className="tabular-nums" style={{ marginTop: 16, fontSize: "0.6875rem", color: "var(--text-300)", fontFamily: "var(--font-mono)" }}>Checked {new Date(state.at).toLocaleString()}</p>}
    </SimplePage>
  );
}

/* ── SIMPLE INFO PAGE ── */

function SimpleInfoPage({ title, summary }) {
  return (
    <SimplePage title={title}>
      <p style={{ fontSize: "var(--text-base)", color: "var(--text-200)" }}>{summary}</p>
      <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
        <a href="/" style={{
          display: "inline-flex", alignItems: "center", padding: "10px 20px",
          fontSize: "var(--text-sm)", fontWeight: 600,
          backgroundColor: "var(--text-100)", color: "var(--bg-100)", borderRadius: 10, textDecoration: "none",
        }}>
          Go home &rarr;
        </a>
        <a href="/support" style={{
          display: "inline-flex", alignItems: "center", padding: "10px 20px",
          fontSize: "var(--text-sm)", fontWeight: 500,
          border: "1px solid var(--border)", color: "var(--text-200)", borderRadius: 10, textDecoration: "none",
        }}>
          Get help
        </a>
      </div>
    </SimplePage>
  );
}

/* ── 404 PAGE ── */

function NotFoundPage() {
  return (
    <SiteLayout>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "clamp(8rem, 20vh, 14rem) 24px 6rem", textAlign: "center" }}>
        <div style={{ fontSize: "var(--text-display)", fontWeight: 800, color: "var(--accent)", lineHeight: 1, marginBottom: 16, letterSpacing: "-0.04em" }}>404</div>
        <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--text-100)", marginBottom: 12 }}>Page not found</h1>
        <p style={{ fontSize: "var(--text-base)", color: "var(--text-200)", lineHeight: 1.6, marginBottom: 32 }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/" style={{ display: "inline-flex", alignItems: "center", padding: "12px 28px", fontSize: "var(--text-sm)", fontWeight: 600, backgroundColor: "var(--text-100)", color: "var(--bg-100)", borderRadius: 8, textDecoration: "none" }}>Go home</a>
          <a href="/support" style={{ display: "inline-flex", alignItems: "center", padding: "12px 28px", fontSize: "var(--text-sm)", fontWeight: 500, border: "1px solid var(--border-strong)", color: "var(--text-100)", borderRadius: 8, textDecoration: "none" }}>Get help</a>
        </div>
      </div>
    </SiteLayout>
  );
}

/* ── CHANGELOG PAGE ── */

function ChangelogPage() {
  const entries = [
    { date: "March 2026", title: "Charter Rules & Approval Inbox", items: ["Three-tier charter system: canDo, askFirst, neverDo", "Real-time approval inbox with decision history", "Keyboard shortcuts (Cmd+K, 1/2/3 navigation)", "Skeleton loading screens across all views"] },
    { date: "February 2026", title: "AI Team Builder", items: ["Natural language team generation — describe your business, get workers", "24+ model selection with cost-based categories", "Staged progress feedback during team creation", "Mobile bottom navigation and responsive settings"] },
    { date: "January 2026", title: "Platform Launch", items: ["Worker deployment with scheduling (continuous, hourly, daily, cron)", "Gmail, Slack, GitHub, and Stripe integrations via OAuth", "Dark mode with full CSS variable theming", "Open source under Apache 2.0"] },
  ];
  return (
    <SiteLayout>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "clamp(8rem, 18vh, 12rem) 24px 6rem" }}>
        <InView><h1 style={{ fontSize: "var(--text-2xl)", fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text-100)", marginBottom: 12 }}>Changelog</h1></InView>
        <InView delay={0.05}><p style={{ fontSize: "var(--text-base)", color: "var(--text-200)", lineHeight: 1.6, marginBottom: 48 }}>What's new and improved in Nooterra.</p></InView>
        {entries.map((entry, i) => (
          <InView key={i} delay={0.1 + i * 0.05}>
            <div style={{ marginBottom: 48, paddingBottom: 48, borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontFamily: "var(--font-mono)" }}>{entry.date}</div>
              <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, color: "var(--text-100)", marginBottom: 16 }}>{entry.title}</h2>
              <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {entry.items.map((item, j) => (
                  <li key={j} style={{ fontSize: "var(--text-sm)", color: "var(--text-200)", lineHeight: 1.6 }}>{item}</li>
                ))}
              </ul>
            </div>
          </InView>
        ))}
      </div>
    </SiteLayout>
  );
}

/* ── PRICING PAGE ── */

const PRICING_TIERS = [
  {
    name: "Preview", price: "$0", period: "",
    description: "See your team proposal, shadow mode preview, and ROI estimate. No live automation.",
    features: ["Team proposal for your business", "Shadow mode preview", "ROI estimate", "Standard AI models"],
    cta: "Try free", ctaHref: "/signup", ctaExternal: false, highlighted: false,
  },
  {
    name: "Live Team", price: "$99", period: "/mo",
    description: "Your AI team, live. Inbox, approvals, audit trail, and real integrations.",
    features: ["Everything in Preview", "Live worker automation", "Email and calendar integrations", "Approval inbox", "Activity feed and audit trail", "Standard model routing"],
    cta: "Start free preview", ctaHref: "/signup", ctaExternal: false, highlighted: true,
  },
  {
    name: "Enterprise", price: "Custom", period: "",
    description: "SSO, compliance, custom integrations, and dedicated support.",
    features: ["Everything in Live Team", "SSO and admin controls", "Custom integrations", "Audit log export", "Dedicated support", "SLA guarantee"],
    cta: "Contact us", ctaHref: "/support", ctaExternal: false, highlighted: false,
  },
];

function PricingPage() {
  return (
    <SiteLayout>
      <section style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "7rem 24px 3rem" }}>
        <FadeIn>
          <h1 style={{ fontSize: "var(--text-2xl)", letterSpacing: "-0.03em", fontWeight: 700, color: "var(--text-100)" }}>Pricing</h1>
          <p style={{ marginTop: 20, maxWidth: 520, fontSize: "var(--text-base)", lineHeight: 1.6, color: "var(--text-200)" }}>
            Preview free. Go live when you're ready.
          </p>
        </FadeIn>
      </section>

      <section style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "0 24px 6rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {PRICING_TIERS.map((tier, i) => (
            <FadeIn key={tier.name} delay={i * 0.08}>
              <div style={{
                display: "flex", flexDirection: "column", height: "100%", padding: 32,
                border: tier.highlighted ? "2px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: 16,
                backgroundColor: tier.highlighted ? "var(--accent-subtle)" : "var(--bg-400)",
              }}>
                <div>
                  <p style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: tier.highlighted ? "var(--accent)" : "var(--text-300)", margin: 0 }}>
                    {tier.name}
                  </p>
                  <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 4 }}>
                    <span style={{ fontSize: "var(--text-2xl)", fontWeight: 700, letterSpacing: "-0.03em", color: "var(--text-100)" }}>{tier.price}</span>
                    {tier.period && <span style={{ fontSize: "var(--text-sm)", color: "var(--text-300)" }}>{tier.period}</span>}
                  </div>
                  <p style={{ marginTop: 16, fontSize: "var(--text-sm)", lineHeight: 1.6, color: "var(--text-200)" }}>{tier.description}</p>
                </div>

                <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                  {tier.features.map((f) => (
                    <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tier.highlighted ? "var(--accent)" : "var(--text-300)"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span style={{ fontSize: "var(--text-sm)", color: "var(--text-200)" }}>{f}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 28 }}>
                  <a
                    href={tier.ctaHref}
                    style={
                      tier.highlighted
                        ? { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "12px 20px", fontSize: "var(--text-sm)", fontWeight: 600, backgroundColor: "var(--text-100)", color: "var(--bg-100)", borderRadius: 10, textDecoration: "none", transition: "opacity 200ms" }
                        : { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "12px 20px", fontSize: "var(--text-sm)", fontWeight: 500, border: "1px solid var(--border-strong)", color: "var(--text-200)", borderRadius: 10, textDecoration: "none", transition: "border-color 200ms" }
                    }
                    onMouseEnter={(e) => { if (tier.highlighted) e.currentTarget.style.opacity = "0.85"; else e.currentTarget.style.borderColor = "var(--text-200)"; }}
                    onMouseLeave={(e) => { if (tier.highlighted) e.currentTarget.style.opacity = "1"; else e.currentTarget.style.borderColor = "var(--border-strong)"; }}
                    {...(tier.ctaExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    {tier.cta}
                  </a>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section style={{ maxWidth: "var(--max-w)", margin: "0 auto", padding: "0 24px var(--section-pad)" }}>
        <InView>
          <h2 style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--text-100)", marginBottom: 32, letterSpacing: "-0.02em" }}>Common questions</h2>
        </InView>
        {[
          { q: "What counts as a worker run?", a: "Each time a worker executes its task — whether triggered by schedule, API call, or manual run — counts as one run. Failed runs that error before taking action don't count." },
          { q: "Can I change plans later?", a: "Yes. Upgrade or downgrade anytime. When you upgrade, you're charged pro-rata for the remainder of the billing period. Downgrades take effect at the next billing cycle." },
          { q: "What happens when I hit my limits?", a: "Workers pause and you'll get a notification. No surprise charges. You can upgrade your plan or wait for the next cycle." },
          { q: "Do I need my own API keys?", a: "On the Free tier, yes — you bring your own model API keys. On paid tiers, model access is included in the price." },
          { q: "Is my data used to train models?", a: "No. Your data is never used for model training. See our privacy policy for details." },
        ].map((faq, i) => (
          <InView key={i} delay={0.05 * i}>
            <div style={{ padding: "20px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text-100)", marginBottom: 8 }}>{faq.q}</div>
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-200)", lineHeight: 1.7 }}>{faq.a}</div>
            </div>
          </InView>
        ))}
      </section>
    </SiteLayout>
  );
}

/* ── MAIN EXPORT ── */

export default function LovableSite({ mode = "home" }) {
  if (mode === "pricing") return <PricingPage />;
  if (mode === "changelog") return <ChangelogPage />;
  if (mode === "not_found") return <NotFoundPage />;
  if (mode === "status") return <StatusPage />;
  if (mode === "security") return <SecurityPage />;
  if (mode === "privacy") return <PrivacyPage />;
  if (mode === "terms") return <TermsPage />;
  if (mode === "support") return <SupportPage />;

  if (mode === "product" || mode === "demo" || mode === "developers" || mode === "integrations") return <HomePage />;

  if (typeof mode === "string" && mode.startsWith("docs")) {
    if (typeof window !== "undefined") window.location.replace(DOCS_EXTERNAL);
    return null;
  }

  if (mode === "onboarding") {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("experience") === "app") { window.location.replace(MANAGED_ONBOARDING_HREF); return null; }
    }
    return <HomePage />;
  }

  if (mode === "expired") return <SimpleInfoPage title="This link has expired." summary="The approval window closed. Return home to start a new request." />;
  if (mode === "revoked") return <SimpleInfoPage title="This authority was revoked." summary="The grant is no longer valid. Contact support if this is unexpected." />;
  if (mode === "verification_failed") return <SimpleInfoPage title="Verification failed." summary="The action could not be verified. Check your activity feed or contact support." />;
  if (mode === "unsupported_host") return <SimpleInfoPage title="Host not supported." summary="Nooterra currently supports CLI, MCP, and REST API." />;

  if (mode === "wallet" || mode === "approvals" || mode === "receipts" || mode === "disputes") return <HomePage />;

  return <HomePage />;
}
