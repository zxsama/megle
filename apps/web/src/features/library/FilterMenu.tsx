import { Heart, SlidersHorizontal, Star, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TagRecord } from "@megle/core-client";
import { LiquidGlassButton, LiquidGlassSurface } from "../../design/liquid-glass";

type Kind = "image" | "video" | "other";
type MinRating = 1 | 2 | 3 | 4 | 5;

interface FilterMenuProps {
  open?: boolean;
  kind?: Kind;
  minRating?: MinRating;
  favorite?: boolean;
  tagIds: number[];
  tags: TagRecord[];
  onSetKind: (kind: Kind | undefined) => void;
  onSetMinRating: (rating: MinRating | undefined) => void;
  onToggleFavorite: () => void;
  onToggleTag: (tagId: number) => void;
  onClear: () => void;
  onOpenChange?: (open: boolean) => void;
}

const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "other", label: "Other" }
];

const RATINGS: MinRating[] = [1, 2, 3, 4, 5];

export function FilterMenu({
  favorite,
  kind,
  minRating,
  onClear,
  onOpenChange,
  onSetKind,
  onSetMinRating,
  onToggleFavorite,
  onToggleTag,
  open: controlledOpen,
  tagIds,
  tags
}: FilterMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const isControlled = controlledOpen !== undefined;
  const open = controlledOpen ?? uncontrolledOpen;
  const hasFilters =
    kind !== undefined ||
    minRating !== undefined ||
    favorite !== undefined ||
    tagIds.length > 0;

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

  useEffect(() => {
    if (!open) return;
    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAndReturnFocus();
      }
    }
    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [closeAndReturnFocus, open]);

  return (
    <div className="filter-menu">
      <LiquidGlassButton
        ref={buttonRef}
        active={open || hasFilters}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Filters"
        className="filter-menu-trigger"
        data-compact-popover="filter"
        data-compact-popover-trigger="filter"
        onClick={() => setOpen(!open)}
        title="Filters"
        tone="control"
        type="button"
      >
        <SlidersHorizontal aria-hidden="true" size={15} />
        {hasFilters ? <span className="filter-menu-dot" aria-hidden="true" /> : null}
      </LiquidGlassButton>

      {open ? (
        <>
          {!isControlled ? (
            <div
              aria-hidden="true"
              className="filter-menu-backdrop"
              onClick={() => closeAndReturnFocus()}
            />
          ) : null}
          <LiquidGlassSurface
            as="div"
            aria-label="Filters"
            className="floating-popover filter-menu-popover"
            data-compact-popover="filter"
            data-compact-popover-root="filter"
            interactive
            role="menu"
            tone="elevated"
          >
            <div className="filter-menu-section" aria-label="Kind">
              <div className="filter-menu-section-title">Kind</div>
              <div className="filter-menu-options">
                {KINDS.map((option) => (
                  <button
                    aria-pressed={kind === option.value}
                    className={kind === option.value ? "filter-menu-item active" : "filter-menu-item"}
                    key={option.value}
                    onClick={() => onSetKind(kind === option.value ? undefined : option.value)}
                    role="menuitemcheckbox"
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-menu-section" aria-label="Rating">
              <div className="filter-menu-section-title">Rating</div>
              <div className="filter-menu-options filter-menu-rating">
                {RATINGS.map((rating) => (
                  <button
                    aria-pressed={minRating === rating}
                    aria-label={`Minimum ${rating} star${rating > 1 ? "s" : ""}`}
                    className={minRating === rating ? "filter-menu-item active" : "filter-menu-item"}
                    key={rating}
                    onClick={() => onSetMinRating(minRating === rating ? undefined : rating)}
                    role="menuitemcheckbox"
                    type="button"
                  >
                    <Star aria-hidden="true" size={12} />
                    <span>{rating}+</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-menu-section" aria-label="Favorite">
              <button
                aria-pressed={favorite === true}
                className={favorite === true ? "filter-menu-item active" : "filter-menu-item"}
                onClick={onToggleFavorite}
                role="menuitemcheckbox"
                type="button"
              >
                <Heart aria-hidden="true" size={13} />
                <span>Favorites</span>
              </button>
            </div>

            <div className="filter-menu-section" aria-label="Tags">
              <div className="filter-menu-section-title">Tags</div>
              <div className="filter-menu-tags">
                {tags.length > 0 ? (
                  tags.map((tag) => (
                    <button
                      aria-pressed={tagIds.includes(tag.id)}
                      className={
                        tagIds.includes(tag.id)
                          ? "filter-menu-item filter-menu-tag active"
                          : "filter-menu-item filter-menu-tag"
                      }
                      key={tag.id}
                      onClick={() => onToggleTag(tag.id)}
                      role="menuitemcheckbox"
                      type="button"
                    >
                      {tag.color ? (
                        <span
                          aria-hidden="true"
                          className="filter-menu-tag-swatch"
                          style={{ background: tag.color }}
                        />
                      ) : null}
                      <span>{tag.name}</span>
                    </button>
                  ))
                ) : (
                  <span className="filter-menu-empty">No tags</span>
                )}
              </div>
            </div>

            <button
              className="filter-menu-clear"
              disabled={!hasFilters}
              onClick={onClear}
              role="menuitem"
              type="button"
            >
              <X aria-hidden="true" size={13} />
              <span>Clear filters</span>
            </button>
          </LiquidGlassSurface>
        </>
      ) : null}
    </div>
  );
}
