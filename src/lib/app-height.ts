/**
 * iOS standalone PWAs mis-resolve CSS viewport units (vh/dvh/% undershoot or
 * overshoot), which floats the bottom nav above the home-indicator band.
 * window.innerHeight is reliable there — pin the shell to it.
 */
export function installAppHeight(): () => void {
  const root = document.documentElement;

  const apply = () => {
    root.style.setProperty("--app-h", `${window.innerHeight}px`);
  };

  apply();
  window.addEventListener("resize", apply);
  window.visualViewport?.addEventListener("resize", apply);
  window.visualViewport?.addEventListener("scroll", apply);

  return () => {
    window.removeEventListener("resize", apply);
    window.visualViewport?.removeEventListener("resize", apply);
    window.visualViewport?.removeEventListener("scroll", apply);
  };
}
