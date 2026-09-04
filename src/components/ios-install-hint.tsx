import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    ("standalone" in window.navigator &&
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)) ||
    window.matchMedia("(display-mode: standalone)").matches;
  return iOS && !standalone;
}

const DISMISS_KEY = "ios-install-hint-dismissed";

export function IosInstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIosSafari()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <Alert className="relative pr-10">
      <Share className="size-4" />
      <AlertTitle>Install on iPhone</AlertTitle>
      <AlertDescription className="space-y-1 text-sm">
        <p>Safari has no Install button. Use:</p>
        <ol className="list-decimal space-y-0.5 pl-4">
          <li>Tap Share</li>
          <li>Add to Home Screen</li>
          <li>Tap Add</li>
        </ol>
        <p className="text-muted-foreground text-xs">
          Prefer HTTPS (not a local http:// IP) so the offline shell can cache.
        </p>
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 size-8"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, "1");
          setShow(false);
        }}
      >
        <X className="size-4" />
      </Button>
    </Alert>
  );
}