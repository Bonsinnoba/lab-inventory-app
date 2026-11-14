import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {startPerformanceProbe} from './lib/performance-probe';
import "./styles/tokens.css";
import "./styles/ui2.css";
import "./styles/sidebar-profile.css";
void startPerformanceProbe().catch(()=>{});

if (typeof window !== "undefined" && (window.location.protocol === "http:" || window.location.protocol === "https:")) {
  window.addEventListener("load", () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // PWA shell caching is an enhancement; the application remains usable without it.
      });
    }
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
