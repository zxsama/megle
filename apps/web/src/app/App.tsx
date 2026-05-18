import {
  Copy,
  ExternalLink,
  Eye,
  FolderInput,
  FolderOpen,
  History,
  Images,
  ListChecks,
  Package,
  Pencil,
  RefreshCw,
  Settings,
  Trash2
} from "lucide-react";
import { useCallback, useState } from "react";
import type { FolderRecord, MediaRecord, RootRecord } from "@megle/core-client";
import {
  copyText,
  getDesktopShellActions,
  openPath,
  revealPath
} from "../core/desktop";
import { useLibraryData, type LibraryState } from "../core/useLibraryData";
import { LiquidGlassButton, LiquidGlassLayer, LiquidGlassSurface } from "../design/liquid-glass";
import { ContextMenu, type ContextMenuItem } from "../features/file-ops/ContextMenu";
import { DeleteConfirm } from "../features/file-ops/DeleteConfirm";
import { MoveDialog } from "../features/file-ops/MoveDialog";
import { RecentOpsPanel } from "../features/file-ops/RecentOpsPanel";
import { RenameDialog } from "../features/file-ops/RenameDialog";
import {
  collectFileIds,
  collectFolderIds,
  targetCounts,
  targetSampleName,
  useFileOpsController,
  type FileOpsController
} from "../features/file-ops/useFileOps";
import { LibrarySidebar } from "../features/library/LibrarySidebar";
import { LibraryView } from "../features/library/LibraryView";
import { OnboardingHero } from "../features/onboarding/OnboardingHero";
import { PluginsView } from "../features/plugins/PluginsView";
import { SettingsView } from "../features/settings/SettingsView";
import { useShortcuts } from "../features/shortcuts/useShortcuts";
import { TaskCenter } from "../features/tasks/TaskCenter";
import { TaskPanel } from "../features/tasks/TaskPanel";
import { WindowChrome } from "../features/window-chrome/WindowChrome";

type AppView = "library" | "tasks" | "plugins" | "settings";

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const tabs = [
  { id: "library", label: "Library", caption: "Library", icon: Images },
  { id: "tasks", label: "Tasks", caption: "Tasks", icon: ListChecks },
  { id: "plugins", label: "Plugins", caption: "Plugins", icon: Package },
  { id: "settings", label: "Settings", caption: "Settings", icon: Settings }
] satisfies Array<{ id: AppView; label: string; caption: string; icon: typeof Images }>;

export function App() {
  const [activeView, setActiveView] = useState<AppView>("library");
  const library = useLibraryData();
  const fileOps = useFileOpsController(library);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [recentOpsOpen, setRecentOpsOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useShortcuts({ library, fileOps });

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleOpenPreview = useCallback(
    (mediaId: number) => {
      library.setSelectedMediaId(mediaId);
      setActiveView("library");
      setPreviewOpen(true);
    },
    [library]
  );

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

  const renameTarget = fileOps.rename.target;
  const moveTarget = fileOps.move.target;
  const removeTarget = fileOps.remove.target;

  return (
    <LiquidGlassLayer>
      <main className="app-shell">
        <LiquidGlassSurface
          as="header"
          className="topbar topbar-drag"
          interactive
          tone="chrome"
        >
          <div className="chrome-title-block">
            <div className="chrome-title">Megle</div>
            <div className="chrome-subtitle">Local media workbench</div>
          </div>
          <nav
            className="top-tabs"
            aria-label="Workbench sections"
            role="tablist"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <LiquidGlassButton
                  active={activeView === tab.id}
                  aria-current={activeView === tab.id ? "page" : undefined}
                  aria-label={tab.label}
                  aria-selected={activeView === tab.id}
                  className={activeView === tab.id ? "top-tab active" : "top-tab"}
                  key={tab.id}
                  onClick={() => setActiveView(tab.id)}
                  role="tab"
                  title={tab.label}
                  tone="control"
                  type="button"
                >
                  <span className="top-tab-icon" aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span className="top-tab-caption" aria-hidden="true">
                    {tab.caption}
                  </span>
                </LiquidGlassButton>
              );
            })}
          </nav>
          <div className="topbar-spacer" />
          {taskDrawerOpen ? (
            <LiquidGlassButton
              active
              aria-label="Close tasks palette"
              aria-pressed="true"
              className="top-action task-drawer-toggle active"
              onClick={() => setTaskDrawerOpen(false)}
              title="Close tasks palette"
              tone="control"
              type="button"
            >
              <ListChecks size={16} />
              <span className="top-action-label">Tasks</span>
            </LiquidGlassButton>
          ) : (
            <LiquidGlassButton
              aria-label="Open tasks palette"
              aria-pressed="false"
              className={library.scanActive ? "top-action task-drawer-toggle active" : "top-action task-drawer-toggle"}
              onClick={() => setTaskDrawerOpen(true)}
              title="Open tasks palette"
              tone="control"
              type="button"
            >
              <ListChecks size={16} />
              <span className="top-action-label">Tasks</span>
              {library.scanActive ? <span className="task-drawer-status" aria-hidden="true" /> : null}
            </LiquidGlassButton>
          )}
          <LiquidGlassButton
            active={recentOpsOpen}
            aria-label="Toggle recent file operations"
            aria-pressed={recentOpsOpen}
            className={`top-action recent-ops-toggle${recentOpsOpen ? " active" : ""}`}
            onClick={() => {
              setRecentOpsOpen((current) => {
                const next = !current;
                if (next) void library.loadRecentOps();
                return next;
              });
            }}
            type="button"
            title="Recent file operations"
          >
            <History size={16} />
            <span className="top-action-label">Recent</span>
          </LiquidGlassButton>
          <WindowChrome />
        </LiquidGlassSurface>

        <LibrarySidebar
          library={library}
          onFolderContextMenu={handleFolderContextMenu}
          onRootContextMenu={handleRootContextMenu}
        />

        {activeView === "library" ? (
          library.roots.length === 0 && !library.loading ? (
            <OnboardingHero
              rootCount={library.roots.length}
              loading={library.loading}
              onAddRoot={(path) => library.addRoot(path)}
            />
          ) : (
            <LibraryView
              library={library}
              onClosePreview={() => setPreviewOpen(false)}
              onMediaContextMenu={handleMediaContextMenu}
              onOpenPreview={handleOpenPreview}
              previewOpen={previewOpen}
            />
          )
        ) : null}
        {activeView === "tasks" ? (
          <TaskCenter
            busyTaskIds={library.busyTaskIds}
            onCancel={(taskId) => {
              void library.cancelTask(taskId);
            }}
            onRefresh={() => {
              void library.refreshTasks();
            }}
            onRetry={(taskId) => {
              void library.retryTask(taskId);
            }}
            scanActive={library.scanActive}
            tasks={library.tasks}
          />
        ) : null}
        {activeView === "plugins" ? <PluginsView /> : null}
        {activeView === "settings" ? <SettingsView library={library} /> : null}

        <TaskPanel
          onClose={() => setTaskDrawerOpen(false)}
          onOpenTaskCenter={() => {
            setTaskDrawerOpen(false);
            setActiveView("tasks");
          }}
          open={taskDrawerOpen}
          scanActive={library.scanActive}
          tasks={library.tasks}
        />

        {recentOpsOpen ? (
          <LiquidGlassSurface
            as="div"
            className="recent-ops-drawer"
            interactive
            scrollable
            tone="elevated"
          >
            <RecentOpsPanel
              loading={library.recentOpsLoading}
              onDismiss={() => setRecentOpsOpen(false)}
              onRefresh={() => void library.loadRecentOps()}
              ops={library.recentOps}
            />
          </LiquidGlassSurface>
        ) : null}

        {menu ? <ContextMenu items={menu.items} onClose={closeMenu} x={menu.x} y={menu.y} /> : null}

        <RenameDialog
          busy={fileOps.rename.busy}
          currentName={renameTarget ? targetSampleName(renameTarget) : ""}
          kind={renameTarget?.kind === "folder" ? "folder" : "file"}
          onCancel={fileOps.closeAll}
          onSubmit={(newName) => void fileOps.submitRename(newName)}
          open={renameTarget !== null}
          serverError={fileOps.rename.serverError}
        />

        <MoveDialog
          busy={fileOps.move.busy}
          fileIds={moveTarget ? collectFileIds(moveTarget) : []}
          folderIds={moveTarget ? collectFolderIds(moveTarget) : []}
          library={library}
          onCancel={fileOps.closeAll}
          onSubmit={(folderId) => void fileOps.submitMove(folderId)}
          open={moveTarget !== null}
          serverError={fileOps.move.serverError}
          serverErrorCode={fileOps.move.serverErrorCode}
        />

        <DeleteConfirm
          busy={fileOps.remove.busy}
          fileCount={removeTarget ? targetCounts(removeTarget).files : 0}
          folderCount={removeTarget ? targetCounts(removeTarget).folders : 0}
          onCancel={fileOps.closeAll}
          onConfirm={() => void fileOps.submitDelete()}
          open={removeTarget !== null}
          permanent={fileOps.remove.permanent}
          serverError={fileOps.remove.serverError}
        />
      </main>
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
