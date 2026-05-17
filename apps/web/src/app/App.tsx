import { History, Images, ListChecks, Package, Settings } from "lucide-react";
import { useCallback, useState } from "react";
import type { FolderRecord, MediaRecord } from "@megle/core-client";
import { useLibraryData } from "../core/useLibraryData";
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
import { TaskCenter } from "../features/tasks/TaskCenter";
import { TaskPanel } from "../features/tasks/TaskPanel";

type AppView = "library" | "tasks" | "plugins" | "settings";

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const tabs = [
  { id: "library", label: "Library", icon: Images },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "plugins", label: "Plugins", icon: Package },
  { id: "settings", label: "Settings", icon: Settings }
] satisfies Array<{ id: AppView; label: string; icon: typeof Images }>;

export function App() {
  const [activeView, setActiveView] = useState<AppView>("library");
  const library = useLibraryData();
  const fileOps = useFileOpsController(library);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [recentOpsOpen, setRecentOpsOpen] = useState(false);

  const closeMenu = useCallback(() => setMenu(null), []);

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
          shiftKey,
          fileOps,
          closeMenu: () => setMenu(null)
        })
      });
    },
    [fileOps]
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
          shiftKey,
          fileOps,
          closeMenu: () => setMenu(null)
        })
      });
    },
    [fileOps]
  );

  const renameTarget = fileOps.rename.target;
  const moveTarget = fileOps.move.target;
  const removeTarget = fileOps.remove.target;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="chrome-title">Megle</div>
        <nav className="top-tabs" aria-label="Workbench sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                aria-current={activeView === tab.id ? "page" : undefined}
                className={activeView === tab.id ? "top-tab active" : "top-tab"}
                key={tab.id}
                onClick={() => setActiveView(tab.id)}
                type="button"
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="topbar-spacer" />
        <button
          aria-label="Toggle recent file operations"
          aria-pressed={recentOpsOpen}
          className={`top-tab${recentOpsOpen ? " active" : ""}`}
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
          <span>Recent ops</span>
        </button>
      </header>

      <LibrarySidebar library={library} onFolderContextMenu={handleFolderContextMenu} />

      {activeView === "library" ? (
        <LibraryView library={library} onMediaContextMenu={handleMediaContextMenu} />
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
      {activeView === "plugins" ? <PlaceholderView title="Plugins" detail="No plugins installed" /> : null}
      {activeView === "settings" ? <PlaceholderView title="Settings" detail="Local library settings" /> : null}

      <TaskPanel scanActive={library.scanActive} tasks={library.tasks} />

      {recentOpsOpen ? (
        <div className="recent-ops-drawer">
          <RecentOpsPanel
            loading={library.recentOpsLoading}
            onDismiss={() => setRecentOpsOpen(false)}
            onRefresh={() => void library.loadRecentOps()}
            ops={library.recentOps}
          />
        </div>
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
  );
}

interface BuildFileItemsArgs {
  file: MediaRecord;
  shiftKey: boolean;
  fileOps: FileOpsController;
  closeMenu: () => void;
}

interface BuildFolderItemsArgs {
  folder: FolderRecord;
  shiftKey: boolean;
  fileOps: FileOpsController;
  closeMenu: () => void;
}

function buildFileItems({
  file,
  shiftKey,
  fileOps,
  closeMenu
}: BuildFileItemsArgs): ContextMenuItem[] {
  return [
    {
      id: "rename",
      label: "Rename…",
      onSelect: () => {
        closeMenu();
        fileOps.openRename({ kind: "file", file });
      }
    },
    {
      id: "move",
      label: "Move to…",
      onSelect: () => {
        closeMenu();
        fileOps.openMove({ kind: "file", file });
      }
    },
    {
      id: "delete-recycle",
      label: "Move to recycle bin",
      onSelect: () => {
        closeMenu();
        fileOps.openDelete({ kind: "file", file }, false);
      }
    },
    ...(shiftKey
      ? [
          {
            id: "delete-permanent",
            label: "Delete permanently",
            danger: true,
            onSelect: () => {
              closeMenu();
              fileOps.openDelete({ kind: "file", file }, true);
            }
          } satisfies ContextMenuItem
        ]
      : [])
  ];
}

function buildFolderItems({
  folder,
  shiftKey,
  fileOps,
  closeMenu
}: BuildFolderItemsArgs): ContextMenuItem[] {
  return [
    {
      id: "rename",
      label: "Rename…",
      onSelect: () => {
        closeMenu();
        fileOps.openRename({ kind: "folder", folder });
      }
    },
    {
      id: "move",
      label: "Move to…",
      onSelect: () => {
        closeMenu();
        fileOps.openMove({ kind: "folder", folder });
      }
    },
    {
      id: "delete-recycle",
      label: "Move to recycle bin",
      onSelect: () => {
        closeMenu();
        fileOps.openDelete({ kind: "folder", folder }, false);
      }
    },
    ...(shiftKey
      ? [
          {
            id: "delete-permanent",
            label: "Delete permanently",
            danger: true,
            onSelect: () => {
              closeMenu();
              fileOps.openDelete({ kind: "folder", folder }, true);
            }
          } satisfies ContextMenuItem
        ]
      : [])
  ];
}

function PlaceholderView({ title, detail }: { title: string; detail: string }) {
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
