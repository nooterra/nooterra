import { docsLinks, ossLinks } from "../config/links.js";

const footerLogoUrl =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_BRAND_LOGO_URL
    ? String(import.meta.env.VITE_BRAND_LOGO_URL).trim()
    : "/brand/settld-logo.png";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <div className="footer-brand-row">
          <img src={footerLogoUrl} alt="" className="footer-brand-logo" />
          <p className="footer-brand">Settld</p>
        </div>
        <p>
          Trust infrastructure for autonomous economic action: policy runtime, execution binding, dispute handling, and
          audit-grade receipts.
        </p>
      </div>
      <div className="footer-links">
        <a href="/product">Product</a>
        <a href="/developers">Developers</a>
        <a href={docsLinks.home}>Docs</a>
        <a href="/security">Security</a>
        <a href={ossLinks.repo}>GitHub</a>
        <a href="/company">Company</a>
      </div>
    </footer>
  );
}
