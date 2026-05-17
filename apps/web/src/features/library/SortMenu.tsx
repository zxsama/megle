import { ArrowDownUp } from "lucide-react";
import { useRef, useState } from "react";

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

  function handleSelect(sort: SortOption) {
    onChange(sort);
    setOpen(false);
    buttonRef.current?.focus();
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
            onClick={() => setOpen(false)}
          />
          <ul
            className="sort-menu-list"
            role="listbox"
            aria-label="Sort options"
          >
            {SORT_OPTIONS.map((option) => (
              <li key={option.value} role="option" aria-selected={value === option.value}>
                <button
                  className={`sort-menu-item${value === option.value ? " sort-menu-item-active" : ""}`}
                  onClick={() => handleSelect(option.value)}
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
