import { ArrowDownUp } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiquidGlassButton, LiquidGlassSurface } from "../../design/liquid-glass";

export type SortOption =
  | "mtime_desc"
  | "mtime_asc"
  | "name_asc"
  | "name_desc"
  | "rating_desc"
  | "rating_asc";

interface SortMenuProps {
  iconOnly?: boolean;
  open?: boolean;
  value: SortOption;
  onChange: (sort: SortOption) => void;
  onOpenChange?: (open: boolean) => void;
}

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "mtime_desc", label: "Newest first" },
  { value: "mtime_asc", label: "Oldest first" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "rating_desc", label: "Highest rated" },
  { value: "rating_asc", label: "Lowest rated" }
];

const SORT_LABEL: Record<SortOption, string> = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.value, o.label])
) as Record<SortOption, string>;

export function SortMenu({
  iconOnly = false,
  open: controlledOpen,
  value,
  onChange,
  onOpenChange
}: SortMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isControlled = controlledOpen !== undefined;
  const open = controlledOpen ?? uncontrolledOpen;
  const selectedLabel = SORT_LABEL[value];

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (isControlled) {
        onOpenChange?.(nextOpen);
        return;
      }
      setUncontrolledOpen(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  const closeAndReturnFocus = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, [setOpen]);

  function handleSelect(sort: SortOption) {
    onChange(sort);
    closeAndReturnFocus();
  }

  // Focus the active option when the menu opens for keyboard users.
  useEffect(() => {
    if (!open) return;
    const initialIndex = Math.max(
      SORT_OPTIONS.findIndex((option) => option.value === value),
      0
    );
    const button = optionRefs.current[initialIndex];
    button?.focus();
  }, [open, value]);

  // Close on Escape (returns focus to trigger).
  useEffect(() => {
    if (!open) return;
    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAndReturnFocus();
      }
    }
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [closeAndReturnFocus, open]);

  function focusOptionAt(index: number) {
    if (SORT_OPTIONS.length === 0) return;
    const wrapped = ((index % SORT_OPTIONS.length) + SORT_OPTIONS.length) % SORT_OPTIONS.length;
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
      focusOptionAt(SORT_OPTIONS.length - 1);
    }
  }

  return (
    <div className="sort-menu">
      <LiquidGlassButton
        ref={buttonRef}
        active={open}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Sort: ${selectedLabel}`}
        className={`sort-menu-trigger${iconOnly ? " sort-menu-trigger-icon-only" : ""}${
          open ? " sort-menu-trigger-open" : ""
        }`}
        data-compact-popover="sort"
        data-compact-popover-trigger="sort"
        onClick={() => setOpen(!open)}
        title={`Sort: ${selectedLabel}`}
        tone="control"
        type="button"
      >
        <ArrowDownUp aria-hidden="true" size={14} />
        {iconOnly ? null : <span>{selectedLabel}</span>}
      </LiquidGlassButton>

      {open ? (
        <>
          {!isControlled ? (
            <div
              aria-hidden="true"
              className="sort-menu-backdrop"
              onClick={() => closeAndReturnFocus()}
            />
          ) : null}
          <LiquidGlassSurface
            as="div"
            className="floating-popover sort-menu-list sort-menu-popover"
            data-compact-popover="sort"
            data-compact-popover-root="sort"
            interactive
            role="listbox"
            aria-label="Sort options"
            tone="elevated"
          >
            {SORT_OPTIONS.map((option, index) => (
              <button
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                aria-selected={value === option.value}
                className={`sort-menu-item${value === option.value ? " sort-menu-item-active" : ""}`}
                key={option.value}
                onClick={() => handleSelect(option.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                role="option"
                type="button"
              >
                {option.label}
              </button>
            ))}
          </LiquidGlassSurface>
        </>
      ) : null}
    </div>
  );
}
