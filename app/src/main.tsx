import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { checkForUpdate } from "./updater";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// In the desktop app, look for a newer release shortly after launch.
setTimeout(() => { void checkForUpdate(); }, 3000);

// Register the service worker in production only (avoids caching during dev/HMR).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
