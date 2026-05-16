import type { MediaRecord } from "@megle/core-client";

interface MediaGridProps {
  items: MediaRecord[];
  selectedMediaId: number | null;
  loading: boolean;
  onSelect: (mediaId: number) => void;
}

export function MediaGrid({ items, selectedMediaId, loading, onSelect }: MediaGridProps) {
  if (loading) {
    return <div className="grid-empty">Loading library</div>;
  }

  if (items.length === 0) {
    return <div className="grid-empty">No indexed media</div>;
  }

  return (
    <div className="tile-grid" aria-label="Media grid">
      {items.map((item) => (
        <button
          className={item.id === selectedMediaId ? "media-tile selected" : "media-tile"}
          key={item.id}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          <div className="tile-thumb">
            <span>{item.kind ?? "file"}</span>
          </div>
          <div className="tile-label" title={item.name}>
            {item.name}
          </div>
        </button>
      ))}
    </div>
  );
}
