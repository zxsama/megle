import {
  GalleryVerticalEnd,
  LayoutGrid,
  LayoutList,
  LayoutPanelTop,
  type LucideIcon
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LiquidGlassButton, LiquidGlassSurface } from "../../design/liquid-glass";
import { useAnchoredPopoverStyle } from "./anchoredPopover";
import {
  LIBRARY_LAYOUT_MODES,
  type LibraryLayoutMode
} from "../media-grid/layoutMode";

interface LayoutMenuProps {
  iconOnly?: boolean;
  value: LibraryLayoutMode;
  onChange: (mode: LibraryLayoutMode) => void;
  titlebarControlId?: string;
}

const LAYOUT_ICON: Record<LibraryLayoutMode, LucideIcon> = {
  adaptive: LayoutPanelTop,
  waterfall: GalleryVerticalEnd,
  grid: LayoutGrid,
  list: LayoutList
};

const LAYOUT_LABEL: Record<LibraryLayoutMode, string> = Object.fromEntries(
  LIBRARY_LAYOUT_MODES.map((option) => [option.value, option.label])
) as Record<LibraryLayoutMode, string>;

const LAYOUT_MENU_MIN_WIDTH_PX = 180;

export function LayoutMenu({
  iconOnly = true,
  onChange,
  titlebarControlId = "library-layout",
  value
}: LayoutMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedLabel = LAYOUT_LABEL[value];
  const TriggerIcon = LAYOUT_ICON[value];
  const popoverStyle = useAnchoredPopoverStyle(open, buttonRef, {
    minWidth: LAYOUT_MENU_MIN_WIDTH_PX
  });

  const closeAndReturnFocus = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  function handleSelect(mode: LibraryLayoutMode) {
    onChange(mode);
    closeAndReturnFocus();
  }

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(
      LIBRARY_LAYOUT_MODES.findIndex((option) => option.value === value),
      0
    );
    optionRefs.current[selectedIndex]?.focus();
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAndReturnFocus();
      }
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [closeAndReturnFocus, open]);

  function focusOptionAt(index: number) {
    if (LIBRARY_LAYOUT_MODES.length === 0) return;
    const wrapped =
      ((index % LIBRARY_LAYOUT_MODES.length) + LIBRARY_LAYOUT_MODES.length) %
      LIBRARY_LAYOUT_MODES.length;
    optionRefs.current[wrapped]?.focus();
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOptionAt(index + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOptionAt(index - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusOptionAt(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusOptionAt(LIBRARY_LAYOUT_MODES.length - 1);
    }
  }

  const popover =
    open && typeof document !== "undefined"
      ? createPortal(
          <>
            <div aria-hidden="true" className="sort-menu-backdrop" onClick={closeAndReturnFocus} />
            <LiquidGlassSurface
              as="div"
              className="floating-popover sort-menu-list sort-menu-popover layout-menu-popover popup-surface"
              interactive
              role="listbox"
              aria-label="Layout options"
              ref={popoverRef}
              style={popoverStyle}
              tone="elevated"
            >
              {LIBRARY_LAYOUT_MODES.map((option, index) => {
                const OptionIcon = LAYOUT_ICON[option.value];
                const selected = value === option.value;
                return (
                  <button
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    aria-selected={selected}
                    className={`sort-menu-item layout-menu-item${selected ? " sort-menu-item-active" : ""}`}
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    onKeyDown={(event) => handleOptionKeyDown(event, index)}
                    role="option"
                    type="button"
                  >
                    <OptionIcon aria-hidden="true" size={14} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </LiquidGlassSurface>
          </>,
          document.body
        )
      : null;

  return (
    <div className="sort-menu layout-menu">
      <LiquidGlassButton
        ref={buttonRef}
        active={open}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Layout: ${selectedLabel}`}
        className={`sort-menu-trigger layout-menu-trigger${iconOnly ? " sort-menu-trigger-icon-only" : ""}${
          open ? " sort-menu-trigger-open" : ""
        }`}
        data-titlebar-control={titlebarControlId}
        onClick={() => setOpen(!open)}
        title={`Layout: ${selectedLabel}`}
        tone="control"
        type="button"
      >
        <TriggerIcon aria-hidden="true" size={14} />
        {iconOnly ? null : <span>{selectedLabel}</span>}
      </LiquidGlassButton>
      {popover}
    </div>
  );
}
