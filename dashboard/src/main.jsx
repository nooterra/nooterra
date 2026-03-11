import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.jsx";
import { initFrontendSentry, withFrontendSentryBoundary } from "./sentry.jsx";
import "./styles/globals.css";
import "./styles/lovable.css";

initFrontendSentry();

const appTree = withFrontendSentryBoundary(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root")).render(appTree);
