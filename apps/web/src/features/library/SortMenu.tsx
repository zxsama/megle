import { ArrowDownUp } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export type SortOption =
  | "mtime_desc"
  | "mtime_asc"
  | "name_asc"
  | "name_desc"
  | "rating_desc"
  | "rating_asc";

interface SortMenuProps {
  value: SortOption;
  onChange: (sort: SortOption) => void;
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

export function SortMenu({ value, onChange }: SortMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const closeAndReturnFocus = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

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
    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndReturnFocus();
      }
    }
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
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
      <button
        ref={buttonRef}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Sort: ${SORT_LABEL[value]}`}
        className={`sort-menu-trigger${open ? " sort-menu-trigger-open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <ArrowDownUp aria-hidden="true" size={14} />
        <span>{SORT_LABEL[value]}</span>
      </button>

      {open ? (
        <>
          {/* Backdrop to close on outside click */}
          <div
            aria-hidden="true"
            className="sort-menu-backdrop"
            onClick={() => closeAndReturnFocus()}
          />
          <ul
            className="sort-menu-list"
            role="listbox"
            aria-label="Sort options"
          >
            {SORT_OPTIONS.map((option, index) => (
              <li key={option.value}>
                <button
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  aria-selected={value === option.value}
                  className={`sort-menu-item${value === option.value ? " sort-menu-item-active" : ""}`}
                  onClick={() => handleSelect(option.value)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  role="option"
                  type="button"
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
