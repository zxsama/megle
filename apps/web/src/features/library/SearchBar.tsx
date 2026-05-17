import { Search, X } from "lucide-react";
import { useRef } from "react";
import { LiquidGlassSurface } from "../../design/liquid-glass";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = "Search library…" }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <LiquidGlassSurface as="div" className="search-bar" interactive tone="control">
      <Search aria-hidden="true" className="search-bar-icon" size={15} />
      <input
        ref={inputRef}
        aria-label="Search library"
        className="search-bar-input"
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value ? (
        <button
          aria-label="Clear search"
          className="search-bar-clear"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          type="button"
        >
          <X size={13} />
        </button>
      ) : null}
    </LiquidGlassSurface>
  );
}
