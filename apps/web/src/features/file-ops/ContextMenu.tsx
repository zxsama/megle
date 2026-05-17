import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Accessible label for the menu wrapper (`role="menu"`). */
  ariaLabel?: string;
}

const MENU_GAP = 4;

export function ContextMenu({ x, y, items, onClose, ariaLabel = "Item actions" }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - MENU_GAP) {
      left = Math.max(MENU_GAP, window.innerWidth - rect.width - MENU_GAP);
    }
    if (top + rect.height > window.innerHeight - MENU_GAP) {
      top = Math.max(MENU_GAP, window.innerHeight - rect.height - MENU_GAP);
    }
    setPosition({ left, top });
  }, [x, y]);

  // Capture trigger and focus first item on open; restore on unmount/close.
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const first = firstEnabledItem(itemRefs.current);
    if (first) {
      first.focus();
    } else {
      ref.current?.focus();
    }
    return () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
    // Run once on mount: items are stable for the lifetime of a single open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handlePointer(event: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    function handleScroll() {
      onClose();
    }

    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("contextmenu", handlePointer);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("contextmenu", handlePointer);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  function focusItem(index: number) {
    const buttons = itemRefs.current;
    if (buttons.length === 0) return;
    const total = buttons.length;
    let i = ((index % total) + total) % total;
    // Skip disabled items, walking forward up to total times.
    for (let step = 0; step < total; step += 1) {
      const node = buttons[i];
      if (node && !node.disabled) {
        node.focus();
        return;
      }
      i = (i + 1) % total;
    }
  }

  function focusItemReverse(index: number) {
    const buttons = itemRefs.current;
    if (buttons.length === 0) return;
    const total = buttons.length;
    let i = ((index % total) + total) % total;
    for (let step = 0; step < total; step += 1) {
      const node = buttons[i];
      if (node && !node.disabled) {
        node.focus();
        return;
      }
      i = (i - 1 + total) % total;
    }
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const buttons = itemRefs.current;
    const active = document.activeElement;
    const currentIndex = buttons.findIndex((node) => node === active);
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const start = currentIndex < 0 ? 0 : currentIndex + 1;
        focusItem(start);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const start = currentIndex < 0 ? buttons.length - 1 : currentIndex - 1;
        focusItemReverse(start);
        break;
      }
      case "Home": {
        event.preventDefault();
        focusItem(0);
        break;
      }
      case "End": {
        event.preventDefault();
        focusItemReverse(buttons.length - 1);
        break;
      }
      case " ":
      case "Spacebar": {
        if (currentIndex >= 0) {
          const item = items[currentIndex];
          if (item && !item.disabled) {
            event.preventDefault();
            item.onSelect();
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const style: CSSProperties = {
    left: position.left,
    top: position.top
  };

  return (
    <div
      aria-label={ariaLabel}
      className="context-menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleMenuKeyDown}
      ref={ref}
      role="menu"
      style={style}
      tabIndex={-1}
    >
      {items.map((item, index) => (
        <button
          aria-disabled={item.disabled}
          className={`context-menu-item${item.danger ? " context-menu-item-danger" : ""}`}
          disabled={item.disabled}
          key={item.id}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
          }}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          role="menuitem"
          type="button"
        >
          {item.icon ? <span className="context-menu-icon">{item.icon}</span> : null}
          <span className="context-menu-label">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function firstEnabledItem(
  buttons: Array<HTMLButtonElement | null>
): HTMLButtonElement | null {
  for (const node of buttons) {
    if (node && !node.disabled) return node;
  }
  return null;
}
