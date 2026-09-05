import { Component, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { BottomNav } from "@/components/bottom-nav";
import { TodayPage } from "@/pages/today-page";
import { HistoryPage } from "@/pages/history-page";
import { SettingsPage } from "@/pages/settings-page";
import { Button } from "@/components/ui/button";
import { useScanQueue } from "@/hooks/use-meals";

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

export default function App() {
  useScanQueue();

  return (
    <div
      className="bg-background flex h-dvh flex-col"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        backgroundImage:
          "radial-gradient(ellipse 120% 80% at 50% -20%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%)",
      }}
    >
      <main className="min-h-0 flex-1 overflow-y-auto">
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