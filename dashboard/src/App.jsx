import DemoApp from "./DemoApp.jsx";
import SiteShell from "./site/SiteShell.jsx";

function shouldShowDemo() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return (
    url.searchParams.get("demo") === "1" ||
    url.hash === "#demo" ||
    window.location.pathname === "/demo"
  );
}

export default function App() {
  return shouldShowDemo() ? <DemoApp /> : <SiteShell />;
}
