import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import App from "./App";
import { requestPersistentStorage } from "./lib/db";
import "./index.css";

// Persist storage early so meal blobs are not evicted when a new SW precaches.
void requestPersistentStorage();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast.message("Update available", {
      description:
        "Reload to get the latest app shell. Your meals stay on this device.",
      duration: Infinity,
      action: {
        label: "Reload",
        onClick: () => {
          void updateSW(true);
        },
      },
    });
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);