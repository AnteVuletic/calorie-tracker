import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { BottomNav } from "@/components/bottom-nav";
import { TodayPage } from "@/pages/today-page";
import { HistoryPage } from "@/pages/history-page";
import { SettingsPage } from "@/pages/settings-page";
import { Button } from "@/components/ui/button";
import { purgeOldMeals } from "@/lib/db";
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

  useEffect(() => {
    void purgeOldMeals().catch((err) => console.error(err));
  }, []);

  return (
    <div
      className="bg-background min-h-full"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        backgroundImage:
          "radial-gradient(ellipse 120% 80% at 50% -20%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%)",
      }}
    >
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
      <BottomNav />
      <Toaster richColors position="top-center" />
    </div>
  );
}