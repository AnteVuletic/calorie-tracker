import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { requestPersistentStorage } from "./lib/db";
import {
  bindPwaUpdateHandler,
  notifyPwaUpdateAvailable,
} from "./lib/pwa-update";
import "./index.css";

// Persist storage early so meal blobs are not evicted when a new SW precaches.
void requestPersistentStorage();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    notifyPwaUpdateAvailable();
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Standalone PWAs often miss updates while backgrounded — recheck on focus.
    const check = () => {
      void registration.update();
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.setInterval(check, 60 * 60 * 1000);
  },
});

bindPwaUpdateHandler(updateSW);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
