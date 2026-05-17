import type { CSSProperties, ReactNode } from "react";
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
}

const MENU_GAP = 4;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
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

  const style: CSSProperties = {
    left: position.left,
    top: position.top
  };

  return (
    <div
      className="context-menu"
      ref={ref}
      role="menu"
      style={style}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          aria-disabled={item.disabled}
          className={`context-menu-item${item.danger ? " context-menu-item-danger" : ""}`}
          disabled={item.disabled}
          key={item.id}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
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
