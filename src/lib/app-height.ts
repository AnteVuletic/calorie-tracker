/**
 * iOS standalone PWAs report a viewport that excludes the home-indicator band,
 * so every CSS viewport unit — and `window.innerHeight` — comes up ~34px short
 * and the bottom nav floats above the screen edge.
 *
 * Publishes two custom properties:
 *   --app-h   shell height, extended to the physical screen when short
 *   --safe-b  bottom inset the nav must keep clear of the home indicator
 */
const MAX_BOTTOM_INSET = 60;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    ("standalone" in window.navigator &&
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

/** Resolved value of env(safe-area-inset-bottom), which is 0 in some standalone modes. */
function measureSafeAreaBottom(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(probe);
  const value = parseFloat(getComputedStyle(probe).paddingBottom);
  probe.remove();
  return Number.isFinite(value) ? value : 0;
}

function measure() {
  const height = window.innerHeight;
  // Only trust the screen delta in standalone; in a browser it is chrome/UI.
  const shortfall = isStandalone()
    ? Math.min(
        Math.max(Math.round(window.screen.height - height), 0),
        MAX_BOTTOM_INSET,
      )
    : 0;

  return {
    height: height + shortfall,
    safeBottom: Math.max(measureSafeAreaBottom(), shortfall),
  };
}

export function installAppHeight(): () => void {
  const root = document.documentElement;

  const apply = () => {
    const { height, safeBottom } = measure();
    root.style.setProperty("--app-h", `${height}px`);
    root.style.setProperty("--safe-b", `${safeBottom}px`);
  };

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  window.visualViewport?.addEventListener("resize", apply);

  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
    window.visualViewport?.removeEventListener("resize", apply);
  };
}
