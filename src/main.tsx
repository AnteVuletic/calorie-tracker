import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import App from "./App";
import "./index.css";

registerSW({
  immediate: true,
  onNeedRefresh() {
    toast.message("Update available", {
      description: "Reload to get the latest app shell.",
      duration: Infinity,
      action: {
        label: "Reload",
        onClick: () => window.location.reload(),
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