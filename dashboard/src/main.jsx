import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App.jsx";
import "./styles/globals.css";
import "./styles/lovable.css";

const appTree = <React.StrictMode><App /></React.StrictMode>;

ReactDOM.createRoot(document.getElementById("root")).render(appTree);
