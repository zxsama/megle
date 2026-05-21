import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  History,
  Images,
  ListChecks,
  Maximize2,
  Minimize2,
  Package,
  RefreshCw,
  RotateCcw,
  Settings
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { LiquidGlassButton } from "../design/liquid-glass";
import { FilterMenu } from "../features/library/FilterMenu";
import { SearchBar } from "../features/library/SearchBar";
import { SortMenu } from "../features/library/SortMenu";
import { WindowChrome } from "../features/window-chrome/WindowChrome";

export type ShellWorkspaceView = "library" | "plugins" | "settings";

type FilterMenuProps = ComponentProps<typeof FilterMenu>;
type SearchBarProps = ComponentProps<typeof SearchBar>;
type SortMenuProps = ComponentProps<typeof SortMenu>;
type PreviewViewMode = "fit-long-edge" | "actual";

interface LibraryTitlebarToolbarProps {
  favorite: FilterMenuProps["favorite"];
  filterOpen: boolean;
  kind: FilterMenuProps["kind"];
  mediaCount: number;
  minRating: FilterMenuProps["minRating"];
  onClearFilters: FilterMenuProps["onClear"];
  onFilterOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onSetKind: FilterMenuProps["onSetKind"];
  onSetMinRating: FilterMenuProps["onSetMinRating"];
  onSetQ: SearchBarProps["onChange"];
  onSetSort: SortMenuProps["onChange"];
  onSortOpenChange: (open: boolean) => void;
  onToggleFavorite: FilterMenuProps["onToggleFavorite"];
  onToggleTag: FilterMenuProps["onToggleTag"];
  q: SearchBarProps["value"];
  scanActive: boolean;
  searchActive: boolean;
  sort: SortMenuProps["value"];
  sortOpen: boolean;
  tagIds: FilterMenuProps["tagIds"];
  tags: FilterMenuProps["tags"];
  title: string;
}

interface PreviewTitlebarToolbarProps {
  canGoNext: boolean;
  canGoPrevious: boolean;
  mode: PreviewViewMode;
  scale: number;
  selectedName: string;
  onBack: () => void;
  onGoNext: () => void;
  onGoPrevious: () => void;
  onResetView: () => void;
  onToggleActualSize: () => void;
}

interface ShellRightActionsProps {
  recentOpsOpen: boolean;
  scanActive: boolean;
  taskPaletteOpen: boolean;
  onCloseTasks: () => void;
  onOpenTasks: () => void;
  onToggleRecent: () => void;
}

const tabs = [
  { id: "library", label: "Library", caption: "Library", icon: Images },
  { id: "plugins", label: "Plugins", caption: "Plugins", icon: Package },
  { id: "settings", label: "Settings", caption: "Settings", icon: Settings }
] satisfies Array<{
  id: ShellWorkspaceView;
  label: string;
  caption: string;
  icon: LucideIcon;
}>;

export function ShellPrimaryNav({
  activeView,
  onSelectView
}: {
  activeView: ShellWorkspaceView;
  onSelectView: (view: ShellWorkspaceView) => void;
}) {
  return (
    <nav className="shell-primary-nav no-drag" aria-label="Workbench sections" role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <LiquidGlassButton
            active={activeView === tab.id}
            aria-current={activeView === tab.id ? "page" : undefined}
            aria-label={tab.label}
            aria-selected={activeView === tab.id}
            className={
              activeView === tab.id
                ? "shell-nav-button active no-drag"
                : "shell-nav-button no-drag"
            }
            key={tab.id}
            onClick={() => onSelectView(tab.id)}
            role="tab"
            title={tab.label}
            tone="control"
            type="button"
          >
            <Icon aria-hidden="true" size={17} />
            <span className="shell-nav-caption">{tab.caption}</span>
          </LiquidGlassButton>
        );
      })}
    </nav>
  );
}

export function ShellTitlebarPlaceholder({ label }: { label?: string }) {
  if (!label) {
    return <div className="shell-titlebar-placeholder" aria-hidden="true" />;
  }

  return <div className="shell-titlebar-summary">{label}</div>;
}

export function LibraryTitlebarToolbar({
  favorite,
  filterOpen,
  kind,
  mediaCount,
  minRating,
  onClearFilters,
  onFilterOpenChange,
  onRefresh,
  onSetKind,
  onSetMinRating,
  onSetQ,
  onSetSort,
  onSortOpenChange,
  onToggleFavorite,
  onToggleTag,
  q,
  scanActive,
  searchActive,
  sort,
  sortOpen,
  tagIds,
  tags,
  title
}: LibraryTitlebarToolbarProps) {
  return (
    <div className="titlebar-workspace-toolbar titlebar-library-toolbar">
      <div className="titlebar-workspace-controls titlebar-library-controls no-drag">
        <FilterMenu
          open={filterOpen}
          favorite={favorite}
          kind={kind}
          minRating={minRating}
          onClear={onClearFilters}
          onOpenChange={onFilterOpenChange}
          onSetKind={onSetKind}
          onSetMinRating={onSetMinRating}
          onToggleFavorite={onToggleFavorite}
          onToggleTag={onToggleTag}
          tagIds={tagIds}
          tags={tags}
        />
        <div className="titlebar-tool-title" title="Sort media">
          <SortMenu
            iconOnly
            open={sortOpen}
            value={sort}
            onChange={onSetSort}
            onOpenChange={onSortOpenChange}
          />
        </div>
        <LiquidGlassButton
          aria-label="Refresh library"
          className="titlebar-icon-button"
          onClick={onRefresh}
          title="Refresh"
          tone="control"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={16} />
        </LiquidGlassButton>
      </div>
      <div className="titlebar-workspace-summary titlebar-library-summary" title={title}>
        {mediaCount} media
        {searchActive ? " / filtered" : ""}
        {scanActive ? " / scanning" : ""}
      </div>
      <div className="titlebar-library-search no-drag">
        <SearchBar value={q} onChange={onSetQ} />
      </div>
    </div>
  );
}

export function PreviewTitlebarToolbar({
  canGoNext,
  canGoPrevious,
  mode,
  scale,
  selectedName,
  onBack,
  onGoNext,
  onGoPrevious,
  onResetView,
  onToggleActualSize
}: PreviewTitlebarToolbarProps) {
  const previewScale = `${Math.round(scale * 100)}%`;
  const modeAction = mode === "actual" ? "Fit long edge" : "Actual size";
  const ModeIcon = mode === "actual" ? Minimize2 : Maximize2;

  return (
    <div className="titlebar-workspace-toolbar titlebar-preview-toolbar">
      <div className="titlebar-workspace-controls titlebar-preview-controls no-drag">
        <LiquidGlassButton
          aria-label="Back to library"
          className="titlebar-icon-button library-toolbar-back"
          onClick={onBack}
          title="Back"
          tone="control"
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </LiquidGlassButton>
        <div className="titlebar-preview-divider" aria-hidden="true" />
        <LiquidGlassButton
          aria-label="Previous media"
          className="titlebar-icon-button"
          disabled={!canGoPrevious}
          onClick={onGoPrevious}
          title="Previous"
          tone="control"
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </LiquidGlassButton>
        <LiquidGlassButton
          aria-label="Next media"
          className="titlebar-icon-button"
          disabled={!canGoNext}
          onClick={onGoNext}
          title="Next"
          tone="control"
          type="button"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </LiquidGlassButton>
        <LiquidGlassButton
          aria-label={modeAction}
          aria-pressed={mode === "actual"}
          active={mode === "actual"}
          className="titlebar-icon-button titlebar-preview-mode"
          onClick={onToggleActualSize}
          title={modeAction}
          tone="control"
          type="button"
        >
          <ModeIcon aria-hidden="true" size={15} />
        </LiquidGlassButton>
        <LiquidGlassButton
          aria-label="Reset preview view"
          className="titlebar-icon-button"
          onClick={onResetView}
          title="Reset view"
          tone="control"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={15} />
        </LiquidGlassButton>
      </div>
      <div
        aria-label={`${selectedName}, ${previewScale}`}
        className="titlebar-workspace-summary titlebar-preview-summary titlebar-preview-title"
        title={selectedName}
      >
        {selectedName}
      </div>
      <div className="titlebar-preview-spacer" aria-hidden="true" />
    </div>
  );
}

export function ShellRightActions({
  recentOpsOpen,
  scanActive,
  taskPaletteOpen,
  onCloseTasks,
  onOpenTasks,
  onToggleRecent
}: ShellRightActionsProps) {
  return (
    <div className="shell-right-actions no-drag">
      <LiquidGlassButton
        active={taskPaletteOpen || scanActive}
        aria-label={taskPaletteOpen ? "Close tasks palette" : "Open tasks palette"}
        aria-pressed={taskPaletteOpen}
        className={
          taskPaletteOpen || scanActive
            ? "top-action task-drawer-toggle active no-drag"
            : "top-action task-drawer-toggle no-drag"
        }
        data-compact-popover="tasks"
        data-compact-popover-trigger="tasks"
        onClick={taskPaletteOpen ? onCloseTasks : onOpenTasks}
        title={taskPaletteOpen ? "Close tasks palette" : "Open tasks palette"}
        tone="control"
        type="button"
      >
        <ListChecks size={16} />
        <span className="top-action-label">Tasks</span>
        {scanActive ? <span className="task-drawer-status" aria-hidden="true" /> : null}
      </LiquidGlassButton>
      <LiquidGlassButton
        active={recentOpsOpen}
        aria-label="Toggle recent file operations"
        aria-pressed={recentOpsOpen}
        className={`top-action recent-ops-toggle no-drag${recentOpsOpen ? " active" : ""}`}
        data-compact-popover="recent"
        data-compact-popover-trigger="recent"
        onClick={onToggleRecent}
        title="Recent file operations"
        tone="control"
        type="button"
      >
        <History size={16} />
        <span className="top-action-label">Recent</span>
      </LiquidGlassButton>
      <WindowChrome />
    </div>
  );
}
