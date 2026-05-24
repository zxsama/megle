import {
  Copy,
  ExternalLink,
  Eye,
  FolderInput,
  FolderOpen,
  Pencil,
  RefreshCw,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FolderRecord, MediaRecord, RootRecord } from "@megle/core-client";
import { AppShell } from "../app-shell/AppShell";
import {
  ShellOverlayHost,
  type ShellContextMenuState
} from "../app-shell/ShellOverlayHost";
import {
  LibraryTitlebarToolbar,
  PreviewTitlebarToolbar,
  ShellPrimaryNav,
  ShellRightActions,
  ShellTitlebarPlaceholder,
  type ShellWorkspaceView
} from "../app-shell/ShellTopBar";
import {
  copyText,
  getDesktopShellActions,
  notifyDesktopShellReady,
  openPath,
  revealPath
} from "../core/desktop";
import { prefetchOriginalPreview } from "../core/mediaResources";
import { useLibraryData, type LibraryState } from "../core/useLibraryData";
import { LiquidGlassLayer, useInterfaceStyle } from "../design/liquid-glass";
import { type ContextMenuItem } from "../features/file-ops/ContextMenu";
import {
  useFileOpsController,
  type FileOpsController
} from "../features/file-ops/useFileOps";
import { LibrarySidebar } from "../features/library/LibrarySidebar";
import {
  LibraryCenterPane,
  LibraryInspectorPane
} from "../features/library/LibraryView";
import { OnboardingHero } from "../features/onboarding/OnboardingHero";
import { PluginsView } from "../features/plugins/PluginsView";
import { SettingsView } from "../features/settings/SettingsView";
import { useShortcuts } from "../features/shortcuts/useShortcuts";

type AppView = ShellWorkspaceView;
type CompactPopover = "tasks" | "recent" | "filter" | "sort" | null;
type PreviewViewState = { mode: "fit-long-edge" | "actual"; scale: number };
type PreviewViewCommands = { reset: () => void; toggleActualSize: () => void };

const DEFAULT_PREVIEW_VIEW_STATE: PreviewViewState = {
  mode: "fit-long-edge",
  scale: 1
};
const CENTER_PREVIEW_PREFETCH_RADIUS = 1;

export function App() {
  const [activeView, setActiveView] = useState<AppView>("library");
  const interfaceStyle = useInterfaceStyle();
  const library = useLibraryData();
  const fileOps = useFileOpsController(library);
  const [menu, setMenu] = useState<ShellContextMenuState | null>(null);
  const [activeCompactPopover, setActiveCompactPopover] =
    useState<CompactPopover>(null);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewViewState, setPreviewViewState] =
    useState<PreviewViewState>(DEFAULT_PREVIEW_VIEW_STATE);
  const [previewViewCommands, setPreviewViewCommands] =
    useState<PreviewViewCommands | null>(null);
  const selectedMediaIndex = library.media.findIndex(
    (item) => item.id === library.selectedMediaId
  );
  const canPreviewPrevious = selectedMediaIndex > 0;
  const canPreviewNext =
    selectedMediaIndex >= 0 && selectedMediaIndex < library.media.length - 1;

  useEffect(() => {
    if (!previewOpen || selectedMediaIndex < 0) return;
    for (
      let offset = -CENTER_PREVIEW_PREFETCH_RADIUS;
      offset <= CENTER_PREVIEW_PREFETCH_RADIUS;
      offset += 1
    ) {
      if (offset === 0) continue;
      const neighbor = library.media[selectedMediaIndex + offset];
      if (neighbor) prefetchOriginalPreview(neighbor);
    }
  }, [library.media, previewOpen, selectedMediaIndex]);

  const handleClosePreview = useCallback(() => {
    setPreviewOpen(false);
    setPreviewViewCommands(null);
    setPreviewViewState(DEFAULT_PREVIEW_VIEW_STATE);
  }, []);

  useShortcuts({
    fileOps,
    library,
    onClosePreview: handleClosePreview,
    previewOpen
  });

  useEffect(() => {
    void notifyDesktopShellReady();
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!activeCompactPopover) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setActiveCompactPopover(null);
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          "[data-compact-popover-root], [data-compact-popover-trigger]"
        )
      ) {
        return;
      }
      setActiveCompactPopover(null);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [activeCompactPopover]);

  const setCompactPopover = useCallback(
    (next: CompactPopover) => {
      if (next === "recent") void library.loadRecentOps();
      setActiveCompactPopover(next);
    },
    [library]
  );

  const toggleCompactPopover = useCallback(
    (next: Exclude<CompactPopover, null>) => {
      setActiveCompactPopover((current) => {
        const nextPopover = current === next ? null : next;
        if (nextPopover === "recent") void library.loadRecentOps();
        return nextPopover;
      });
    },
    [library]
  );

  const openTaskPalette = useCallback(() => {
    setTaskCenterOpen(false);
    setCompactPopover("tasks");
  }, [setCompactPopover]);

  const closeTaskPalette = useCallback(() => {
    setCompactPopover(null);
  }, [setCompactPopover]);

  const closeRecentOps = useCallback(() => {
    setCompactPopover(null);
  }, [setCompactPopover]);

  const setFilterOpen = useCallback(
    (open: boolean) => {
      setCompactPopover(open ? "filter" : null);
    },
    [setCompactPopover]
  );

  const setSortOpen = useCallback(
    (open: boolean) => {
      setCompactPopover(open ? "sort" : null);
    },
    [setCompactPopover]
  );

  const recentOpsOpen = activeCompactPopover === "recent";
  const taskDrawerOpen = activeCompactPopover === "tasks";
  const filterMenuOpen = activeCompactPopover === "filter";
  const sortMenuOpen = activeCompactPopover === "sort";

  const onToggleRecent = useCallback(() => {
    toggleCompactPopover("recent");
  }, [toggleCompactPopover]);

  const openTaskCenter = useCallback(() => {
    setCompactPopover(null);
    setTaskCenterOpen(true);
  }, [setCompactPopover]);

  const closeTaskCenter = useCallback(() => {
    setTaskCenterOpen(false);
  }, []);

  const handleOpenPreview = useCallback(
    (mediaId: number) => {
      library.setSelectedMediaId(mediaId);
      setActiveView("library");
      setPreviewViewCommands(null);
      setPreviewViewState(DEFAULT_PREVIEW_VIEW_STATE);
      setPreviewOpen(true);
    },
    [library]
  );

  const handlePreviewPrevious = useCallback(() => {
    if (selectedMediaIndex <= 0) return;
    const previous = library.media[selectedMediaIndex - 1];
    if (previous) {
      library.setSelectedMediaId(previous.id);
    }
  }, [library, selectedMediaIndex]);

  const handlePreviewNext = useCallback(() => {
    if (selectedMediaIndex < 0 || selectedMediaIndex >= library.media.length - 1) return;
    const next = library.media[selectedMediaIndex + 1];
    if (next) {
      library.setSelectedMediaId(next.id);
    }
  }, [library, selectedMediaIndex]);

  const handleMediaContextMenu = useCallback(
    ({
      item,
      x,
      y,
      shiftKey
    }: {
      item: MediaRecord;
      x: number;
      y: number;
      shiftKey: boolean;
    }) => {
      setMenu({
        x,
        y,
        items: buildFileItems({
          file: item,
          library,
          shiftKey,
          fileOps,
          onPreview: handleOpenPreview,
          closeMenu: () => setMenu(null)
        })
      });
    },
    [fileOps, handleOpenPreview, library]
  );

  const handleFolderContextMenu = useCallback(
    ({
      folder,
      x,
      y,
      shiftKey
    }: {
      folder: FolderRecord;
      x: number;
      y: number;
      shiftKey: boolean;
    }) => {
      setMenu({
        x,
        y,
        items: buildFolderItems({
          folder,
          library,
          shiftKey,
          fileOps,
          onOpenFolder: (target) => {
            library.setSelectedFolder(target);
            setActiveView("library");
          },
          onRefreshFolder: (target) => {
            library.setSelectedFolder(target);
            void library.refresh();
          },
          onRescanRoot: (rootId) => {
            void library.rescanRoot(rootId);
          },
          closeMenu: () => setMenu(null)
        })
      });
    },
    [fileOps, library]
  );

  const handleRootContextMenu = useCallback(
    ({
      root,
      x,
      y
    }: {
      root: RootRecord;
      x: number;
      y: number;
      shiftKey: boolean;
    }) => {
      setMenu({
        x,
        y,
        items: buildRootItems({
          root,
          onOpenRoot: (target) => {
            library.setSelectedRootId(target.id);
            setActiveView("library");
          },
          onRefresh: () => void library.refresh(),
          onRescanRoot: (rootId) => {
            void library.rescanRoot(rootId);
          },
          closeMenu: () => setMenu(null)
        })
      });
    },
    [library]
  );

  function renderCenterTitlebar() {
    if (activeView === "library" && previewOpen && library.selectedMedia) {
      return (
        <PreviewTitlebarToolbar
          canGoNext={canPreviewNext}
          canGoPrevious={canPreviewPrevious}
          mode={previewViewState.mode}
          scale={previewViewState.scale}
          selectedName={library.selectedMedia.name}
          onBack={handleClosePreview}
          onGoNext={handlePreviewNext}
          onGoPrevious={handlePreviewPrevious}
          onResetView={() => previewViewCommands?.reset()}
          onToggleActualSize={() => previewViewCommands?.toggleActualSize()}
        />
      );
    }

    if (activeView === "library") {
      const selectedRoot =
        library.roots.find((root) => root.id === library.selectedRootId) ?? null;
      const selectedFolder = library.folders.find(
        (folder) => folder.id === library.selectedFolderId
      );
      return (
        <LibraryTitlebarToolbar
          favorite={library.searchState.favorite}
          filterOpen={filterMenuOpen}
          kind={library.searchState.kind}
          mediaCount={library.media.length}
          minRating={library.searchState.minRating}
          onClearFilters={library.clearFilters}
          onFilterOpenChange={setFilterOpen}
          onRefresh={() => void library.refresh()}
          onSetKind={library.setKind}
          onSetMinRating={library.setMinRating}
          onSetQ={library.setQ}
          onSortOpenChange={setSortOpen}
          onSetSort={library.setSort}
          onToggleFavorite={library.toggleFavoriteFilter}
          onToggleTag={library.toggleTagFilter}
          q={library.searchState.q}
          scanActive={library.scanActive}
          searchActive={library.searchActive}
          sort={library.searchState.sort}
          sortOpen={sortMenuOpen}
          tagIds={library.searchState.tagIds}
          tags={library.tags}
          title={selectedFolder?.name ?? selectedRoot?.displayName ?? "Library"}
        />
      );
    }
    if (activeView === "plugins") {
      return <ShellTitlebarPlaceholder label="Plugins" />;
    }
    return <ShellTitlebarPlaceholder label="Settings" />;
  }

  function renderSidebar() {
    return (
      <LibrarySidebar
        library={library}
        onFolderContextMenu={handleFolderContextMenu}
        onRootContextMenu={handleRootContextMenu}
      />
    );
  }

  function renderCenterPane() {
    if (activeView === "library") {
      return library.roots.length === 0 && !library.loading ? (
        <OnboardingHero
          rootCount={library.roots.length}
          loading={library.loading}
          onAddRoot={(path) => library.addRoot(path)}
        />
      ) : (
        <LibraryCenterPane
          library={library}
          onClosePreview={handleClosePreview}
          onMediaContextMenu={handleMediaContextMenu}
          onOpenPreview={handleOpenPreview}
          onPreviewCommandChange={setPreviewViewCommands}
          onPreviewNext={handlePreviewNext}
          onPreviewPrevious={handlePreviewPrevious}
          onPreviewViewStateChange={setPreviewViewState}
          previewOpen={previewOpen}
        />
      );
    }

    if (activeView === "plugins") {
      return <PluginsView />;
    }

    return <SettingsView interfaceStyle={interfaceStyle} library={library} />;
  }

  function renderRightPane() {
    if (activeView === "library") {
      return <LibraryInspectorPane library={library} previewOpen={previewOpen} />;
    }

    return (
      <aside className="inspector-panel shell-empty-pane" aria-label="Inspector">
        <div className="empty-panel">No selection</div>
      </aside>
    );
  }

  function renderOverlays() {
    return (
      <ShellOverlayHost
        contextMenu={menu}
        fileOps={fileOps}
        library={library}
        onCloseContextMenu={closeMenu}
        onCloseRecentOps={closeRecentOps}
        onCloseTaskPalette={closeTaskPalette}
        onCloseTaskCenter={closeTaskCenter}
        onOpenTaskCenter={openTaskCenter}
        onRefreshRecentOps={() => void library.loadRecentOps()}
        recentOpsOpen={recentOpsOpen}
        taskCenterOpen={taskCenterOpen}
        taskPaletteOpen={taskDrawerOpen}
      />
    );
  }

  return (
    <LiquidGlassLayer>
      <AppShell
        layout={activeView === "library" ? "library" : "simple"}
        titlebarLeft={<ShellPrimaryNav activeView={activeView} onSelectView={setActiveView} />}
        titlebarCenter={renderCenterTitlebar()}
        titlebarRight={
          <ShellRightActions
            recentOpsOpen={recentOpsOpen}
            scanActive={library.scanActive}
            taskPaletteOpen={taskDrawerOpen}
            onCloseTasks={closeTaskPalette}
            onOpenTasks={openTaskPalette}
            onToggleRecent={onToggleRecent}
          />
        }
        sidebar={renderSidebar()}
        centerPane={renderCenterPane()}
        rightPane={renderRightPane()}
        overlays={renderOverlays()}
      />
    </LiquidGlassLayer>
  );
}

interface BuildFileItemsArgs {
  file: MediaRecord;
  library: LibraryState;
  shiftKey: boolean;
  fileOps: FileOpsController;
  onPreview: (mediaId: number) => void;
  closeMenu: () => void;
}

interface BuildFolderItemsArgs {
  folder: FolderRecord;
  library: LibraryState;
  shiftKey: boolean;
  fileOps: FileOpsController;
  onOpenFolder: (folder: FolderRecord) => void;
  onRefreshFolder: (folder: FolderRecord) => void;
  onRescanRoot: (rootId: number) => void;
  closeMenu: () => void;
}

interface BuildRootItemsArgs {
  root: RootRecord;
  onOpenRoot: (root: RootRecord) => void;
  onRefresh: () => void;
  onRescanRoot: (rootId: number) => void;
  closeMenu: () => void;
}

function buildFileItems({
  file,
  library,
  shiftKey,
  fileOps,
  onPreview,
  closeMenu
}: BuildFileItemsArgs): ContextMenuItem[] {
  const filePath = resolveMediaPath(library, file);
  const canReveal = Boolean(filePath && getDesktopShellActions());
  return [
    {
      id: "preview",
      label: "Preview",
      icon: <Eye size={14} />,
      onSelect: () => {
        closeMenu();
        onPreview(file.id);
      }
    },
    {
      id: "open",
      label: "Open",
      icon: <ExternalLink size={14} />,
      disabled: !filePath || !getDesktopShellActions(),
      onSelect: () => {
        closeMenu();
        if (filePath) void openPath(filePath);
      }
    },
    { id: "file-primary-separator", separator: true },
    {
      id: "rename",
      label: "Rename…",
      icon: <Pencil size={14} />,
      onSelect: () => {
        closeMenu();
        fileOps.openRename({ kind: "file", file });
      }
    },
    {
      id: "move",
      label: "Move to…",
      icon: <FolderInput size={14} />,
      onSelect: () => {
        closeMenu();
        fileOps.openMove({ kind: "file", file });
      }
    },
    {
      id: "delete-recycle",
      label: "Move to recycle bin",
      icon: <Trash2 size={14} />,
      onSelect: () => {
        closeMenu();
        fileOps.openDelete({ kind: "file", file }, false);
      }
    },
    {
      id: "delete-permanent",
      label: shiftKey ? "Delete permanently" : "Delete permanently…",
      danger: true,
      icon: <Trash2 size={14} />,
      onSelect: () => {
        closeMenu();
        fileOps.openDelete({ kind: "file", file }, true);
      }
    },
    { id: "file-shell-separator", separator: true },
    {
      id: "copy-path",
      label: "Copy path",
      icon: <Copy size={14} />,
      disabled: !filePath,
      onSelect: () => {
        closeMenu();
        if (filePath) void copyText(filePath);
      }
    },
    {
      id: "reveal",
      label: "Reveal in Explorer",
      icon: <FolderOpen size={14} />,
      disabled: !canReveal,
      onSelect: () => {
        closeMenu();
        if (filePath) void revealPath(filePath);
      }
    }
  ];
}

function buildFolderItems({
  folder,
  library,
  shiftKey,
  fileOps,
  onOpenFolder,
  onRefreshFolder,
  onRescanRoot,
  closeMenu
}: BuildFolderItemsArgs): ContextMenuItem[] {
  const folderPath = resolveFolderPath(library, folder);
  const canReveal = Boolean(folderPath && getDesktopShellActions());
  return [
    {
      id: "open-folder",
      label: "Open folder",
      icon: <FolderOpen size={14} />,
      onSelect: () => {
        closeMenu();
        onOpenFolder(folder);
      }
    },
    {
      id: "refresh-folder",
      label: "Refresh folder",
      icon: <RefreshCw size={14} />,
      onSelect: () => {
        closeMenu();
        onRefreshFolder(folder);
      }
    },
    {
      id: "rescan-root",
      label: "Rescan root",
      icon: <RefreshCw size={14} />,
      onSelect: () => {
        closeMenu();
        onRescanRoot(folder.rootId);
      }
    },
    { id: "folder-primary-separator", separator: true },
    {
      id: "rename",
      label: "Rename…",
      icon: <Pencil size={14} />,
      onSelect: () => {
        closeMenu();
        fileOps.openRename({ kind: "folder", folder });
      }
    },
    {
      id: "move",
      label: "Move to…",
      icon: <FolderInput size={14} />,
      onSelect: () => {
        closeMenu();
        fileOps.openMove({ kind: "folder", folder });
      }
    },
    {
      id: "delete-recycle",
      label: "Move to recycle bin",
      icon: <Trash2 size={14} />,
      onSelect: () => {
        closeMenu();
        fileOps.openDelete({ kind: "folder", folder }, false);
      }
    },
    {
      id: "delete-permanent",
      label: shiftKey ? "Delete permanently" : "Delete permanently…",
      danger: true,
      icon: <Trash2 size={14} />,
      onSelect: () => {
        closeMenu();
        fileOps.openDelete({ kind: "folder", folder }, true);
      }
    },
    { id: "folder-shell-separator", separator: true },
    {
      id: "copy-path",
      label: "Copy path",
      icon: <Copy size={14} />,
      disabled: !folderPath,
      onSelect: () => {
        closeMenu();
        if (folderPath) void copyText(folderPath);
      }
    },
    {
      id: "reveal",
      label: "Reveal in Explorer",
      icon: <FolderOpen size={14} />,
      disabled: !canReveal,
      onSelect: () => {
        closeMenu();
        if (folderPath) void revealPath(folderPath);
      }
    }
  ];
}

function buildRootItems({
  root,
  onOpenRoot,
  onRefresh,
  onRescanRoot,
  closeMenu
}: BuildRootItemsArgs): ContextMenuItem[] {
  const canReveal = Boolean(root.path && getDesktopShellActions());
  return [
    {
      id: "open-root",
      label: "Open root",
      icon: <FolderOpen size={14} />,
      onSelect: () => {
        closeMenu();
        onOpenRoot(root);
      }
    },
    {
      id: "refresh-root",
      label: "Refresh folder",
      icon: <RefreshCw size={14} />,
      onSelect: () => {
        closeMenu();
        onRefresh();
      }
    },
    {
      id: "rescan-root",
      label: "Rescan root",
      icon: <RefreshCw size={14} />,
      onSelect: () => {
        closeMenu();
        onRescanRoot(root.id);
      }
    },
    { id: "root-management-separator", separator: true },
    {
      id: "rename-root",
      label: "Rename root",
      icon: <Pencil size={14} />,
      disabled: true,
      onSelect: () => {}
    },
    {
      id: "move-root",
      label: "Move root",
      icon: <FolderInput size={14} />,
      disabled: true,
      onSelect: () => {}
    },
    {
      id: "delete-root",
      label: "Remove root",
      icon: <Trash2 size={14} />,
      disabled: true,
      onSelect: () => {}
    },
    { id: "root-shell-separator", separator: true },
    {
      id: "copy-path",
      label: "Copy path",
      icon: <Copy size={14} />,
      onSelect: () => {
        closeMenu();
        void copyText(root.path);
      }
    },
    {
      id: "reveal",
      label: "Reveal in Explorer",
      icon: <FolderOpen size={14} />,
      disabled: !canReveal,
      onSelect: () => {
        closeMenu();
        void revealPath(root.path);
      }
    }
  ];
}

function resolveMediaPath(library: LibraryState, file: MediaRecord): string | null {
  const folderPath = resolveFolderPathById(library, file.rootId, file.folderId);
  return folderPath ? joinPath(folderPath, file.name) : null;
}

function resolveFolderPath(library: LibraryState, folder: FolderRecord): string | null {
  return resolveFolderPathById(library, folder.rootId, folder.id);
}

function resolveFolderPathById(
  library: LibraryState,
  rootId: number,
  folderId: number
): string | null {
  const root = library.roots.find((item) => item.id === rootId);
  if (!root) return null;
  if (root.rootFolderId === folderId) return root.path;

  const foldersById = new Map(library.folders.map((folder) => [folder.id, folder]));
  const segments: string[] = [];
  let current = foldersById.get(folderId) ?? null;
  let depth = 0;

  while (current && current.id !== root.rootFolderId && depth < 128) {
    segments.unshift(current.name);
    if (current.parentId === null || current.parentId === root.rootFolderId) break;
    current = foldersById.get(current.parentId) ?? null;
    depth += 1;
  }

  if (segments.length === 0 && folderId !== root.rootFolderId) {
    return null;
  }

  return segments.reduce((path, segment) => joinPath(path, segment), root.path);
}

function joinPath(base: string, segment: string): string {
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${segment.replace(/^[\\/]+/, "")}`;
}

export function PlaceholderView({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="workspace simple-workspace" aria-label={`${title} workbench`}>
      <header className="toolbar">
        <div>
          <div className="toolbar-title">{title}</div>
          <div className="toolbar-meta">{detail}</div>
        </div>
      </header>
    </section>
  );
}
