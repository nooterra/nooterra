import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";

export default function PageFrame({ children }) {
  return (
    <div className="site-root" id="top">
      <div className="site-bg-texture" aria-hidden="true" />
      <div className="site-bg-orb site-bg-orb-a" aria-hidden="true" />
      <div className="site-bg-orb site-bg-orb-b" aria-hidden="true" />
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
