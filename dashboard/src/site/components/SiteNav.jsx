import { useEffect, useState } from "react";

import { fetchBuyerMe, logoutBuyerSession } from "../auth/client.js";
import { clearSession, readSession, subscribeSession, writeSession } from "../auth/session.js";

const links = [
  { href: "/product", label: "Product" },
  { href: "/developers", label: "Developers" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
  { href: "/company", label: "Company" }
];

export default function SiteNav() {
  const [session, setSession] = useState(() => readSession());

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeSession((next) => {
      if (!active) return;
      setSession(next);
    });

    async function hydrateFromServer() {
      const current = readSession();
      if (!current) return;
      try {
        const me = await fetchBuyerMe({ apiBaseUrl: current.apiBaseUrl });
        if (!active || !me?.principal) return;
        const next = writeSession({
          ...current,
          email: me.principal.email,
          role: me.principal.role,
          tenantId: me.principal.tenantId
        });
        setSession(next);
      } catch {
        // Ignore transient failures; session may still be valid.
      }
    }

    hydrateFromServer();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function onSignOut() {
    try {
      await logoutBuyerSession({ apiBaseUrl: session?.apiBaseUrl });
    } catch {
      // logout should still clear client state
    } finally {
      clearSession();
      setSession(null);
      window.location.href = "/";
    }
  }

  return (
    <header className="site-nav-wrap">
      <nav className="site-nav" aria-label="Primary">
        <a href="/" className="brand-mark" aria-label="Settld home">
          <span className="brand-mark-core">Settld</span>
          <span className="brand-mark-sub">Autonomous Commerce Infrastructure</span>
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
          {session ? (
            <>
              <a className="btn btn-solid" href="/app">
                Open workspace
              </a>
              <button type="button" className="btn btn-ghost" onClick={onSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <a className="btn btn-ghost" href="/login">
                Sign in
              </a>
              <a className="btn btn-solid" href="/signup">
                Start free
              </a>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
