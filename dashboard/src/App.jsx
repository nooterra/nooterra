import { useEffect } from "react";

import SiteShell from "./site/SiteShell.jsx";
import OperatorDashboard from "./operator/OperatorDashboard.jsx";
import ProductPage from "./site/pages/ProductPage.jsx";
import DevelopersPage from "./site/pages/DevelopersPage.jsx";
import SecurityPage from "./site/pages/SecurityPage.jsx";
import ProofPage from "./site/pages/ProofPage.jsx";
import CompanyPage from "./site/pages/CompanyPage.jsx";
import PilotPage from "./site/pages/PilotPage.jsx";
import DocsPage from "./site/pages/DocsPage.jsx";
import AuthPage from "./site/pages/AuthPage.jsx";
import WorkspacePage from "./site/pages/WorkspacePage.jsx";
import { docsLinks } from "./site/config/links.js";

function ExternalRedirect({ href }) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.location.replace(href);
    }
  }, [href]);
  return null;
}

function getRouteMode() {
  if (typeof window === "undefined") return "home";
  const rawPath = window.location.pathname;
  const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const url = new URL(window.location.href);

  if (path === "/operator" || url.searchParams.get("operator") === "1") return "operator";
  if (path === "/product") return "product";
  if (path === "/developers") return "developers";
  if (path === "/docs") return "docs";
  if (path === "/docs/quickstart") return "docs_quickstart";
  if (path === "/docs/architecture") return "docs_architecture";
  if (path === "/docs/integrations") return "docs_integrations";
  if (path === "/docs/api") return "docs_api";
  if (path === "/docs/security") return "docs_security";
  if (path === "/docs/ops") return "docs_ops";
  if (path === "/security") return "security";
  if (path === "/proof") return "proof";
  if (path === "/company") return "company";
  if (path === "/pilot") return "pilot";
  if (path === "/login") return "login";
  if (path === "/signup") return "signup";
  if (path === "/app") return "app";
  return "home";
}

export default function App() {
  const mode = getRouteMode();
  if (mode === "operator") return <OperatorDashboard />;
  if (mode === "product") return <ProductPage />;
  if (mode === "developers") return <DevelopersPage />;
  if (mode === "docs") return <DocsPage />;
  if (mode === "docs_quickstart") return <ExternalRedirect href={docsLinks.quickstart} />;
  if (mode === "docs_architecture") return <ExternalRedirect href={docsLinks.architecture} />;
  if (mode === "docs_integrations") return <ExternalRedirect href={docsLinks.integrations} />;
  if (mode === "docs_api") return <ExternalRedirect href={docsLinks.api} />;
  if (mode === "docs_security") return <ExternalRedirect href={docsLinks.security} />;
  if (mode === "docs_ops") return <ExternalRedirect href={docsLinks.ops} />;
  if (mode === "security") return <SecurityPage />;
  if (mode === "proof") return <ProofPage />;
  if (mode === "company") return <CompanyPage />;
  if (mode === "pilot") return <PilotPage />;
  if (mode === "login") return <AuthPage mode="login" />;
  if (mode === "signup") return <AuthPage mode="signup" />;
  if (mode === "app") return <WorkspacePage />;
  return <SiteShell />;
}
