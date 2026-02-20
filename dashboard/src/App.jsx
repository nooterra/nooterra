import DemoApp from "./DemoApp.jsx";
import SiteShell from "./site/SiteShell.jsx";
import PricingPage from "./site/PricingPage.jsx";
import OperatorDashboard from "./operator/OperatorDashboard.jsx";
import ProductPage from "./site/pages/ProductPage.jsx";
import DevelopersPage from "./site/pages/DevelopersPage.jsx";
import SecurityPage from "./site/pages/SecurityPage.jsx";
import CompanyPage from "./site/pages/CompanyPage.jsx";
import AuthPage from "./site/pages/AuthPage.jsx";
import WorkspacePage from "./site/pages/WorkspacePage.jsx";

function getRouteMode() {
  if (typeof window === "undefined") return "home";
  const rawPath = window.location.pathname;
  const path = rawPath.length > 1 && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const url = new URL(window.location.href);

  if (path === "/operator" || url.searchParams.get("operator") === "1") return "operator";
  if (path === "/pricing") return "pricing";
  if (path === "/product") return "product";
  if (path === "/developers") return "developers";
  if (path === "/security") return "security";
  if (path === "/company") return "company";
  if (path === "/login") return "login";
  if (path === "/signup") return "signup";
  if (path === "/app") return "app";
  if (url.searchParams.get("demo") === "1" || url.hash === "#demo" || path === "/demo") return "demo";
  return "home";
}

export default function App() {
  const mode = getRouteMode();
  if (mode === "operator") return <OperatorDashboard />;
  if (mode === "demo") return <DemoApp />;
  if (mode === "pricing") return <PricingPage />;
  if (mode === "product") return <ProductPage />;
  if (mode === "developers") return <DevelopersPage />;
  if (mode === "security") return <SecurityPage />;
  if (mode === "company") return <CompanyPage />;
  if (mode === "login") return <AuthPage mode="login" />;
  if (mode === "signup") return <AuthPage mode="signup" />;
  if (mode === "app") return <WorkspacePage />;
  return <SiteShell />;
}
