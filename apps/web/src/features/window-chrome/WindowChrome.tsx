import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getWindowControls } from "../../core/desktop";

/**
 * Frameless-window controls. Renders nothing when the desktop bridge does
 * not expose `windowControls`, so the same React tree continues to work in
 * the browser dev environment with no Electron host.
 */
export function WindowChrome() {
  const controls = getWindowControls();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!controls) return;
    let cancelled = false;

    function refresh() {
      if (!controls) return;
      void controls.isMaximized().then((value) => {
        if (!cancelled) setIsMaximized(value);
      });
    }

    refresh();
    window.addEventListener("resize", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", refresh);
    };
  }, [controls]);

  if (!controls) {
    return null;
  }

  async function handleMaximize() {
    if (!controls) return;
    const next = await controls.maximize();
    setIsMaximized(next);
  }

  return (
    <div className="window-chrome" role="group" aria-label="Window controls">
      <button
        aria-label="Minimize window"
        className="window-chrome-button"
        onClick={() => void controls.minimize()}
        type="button"
      >
        <Minus size={14} />
      </button>
      <button
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        className="window-chrome-button"
        onClick={() => void handleMaximize()}
        type="button"
      >
        {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>
      <button
        aria-label="Close window"
        className="window-chrome-button window-chrome-button-close"
        onClick={() => void controls.close()}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}
