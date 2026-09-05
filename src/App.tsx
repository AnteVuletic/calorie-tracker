import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { BottomNav } from "@/components/bottom-nav";
import { TodayPage } from "@/pages/today-page";
import { HistoryPage } from "@/pages/history-page";
import { SettingsPage } from "@/pages/settings-page";
import { Button } from "@/components/ui/button";
import { useScanQueue } from "@/hooks/use-meals";
import { applyPwaUpdate, subscribePwaUpdate } from "@/lib/pwa-update";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="font-medium">Something went wrong</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PwaUpdateBanner() {
  const [ready, setReady] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => subscribePwaUpdate(setReady), []);

  if (!ready) return null;

  return (
    <div className="bg-card/95 text-card-foreground border-border fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex items-center gap-3 rounded-xl border p-3 shadow-lg backdrop-blur-sm">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Update available</p>
        <p className="text-muted-foreground text-xs">
          Reload to get the latest app shell. Your meals stay on this device.
        </p>
      </div>
      <Button
        size="sm"
        disabled={updating}
        onClick={() => {
          setUpdating(true);
          void applyPwaUpdate();
        }}
      >
        {updating ? "Updating…" : "Reload"}
      </Button>
    </div>
  );
}

export default function App() {
  useScanQueue();

  return (
    <div
      className="app-shell bg-background fixed inset-0 flex flex-col"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 120% 80% at 50% -20%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%)",
      }}
    >
      <PwaUpdateBanner />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
      <BottomNav />
      <Toaster richColors position="top-center" />
    </div>
  );
}