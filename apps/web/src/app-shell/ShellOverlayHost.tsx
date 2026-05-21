import { LiquidGlassSurface } from "../design/liquid-glass";
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
  type FileOpsController
} from "../features/file-ops/useFileOps";
import { TaskOverlay } from "../features/tasks/TaskOverlay";
import { TaskPanel } from "../features/tasks/TaskPanel";
import { TaskCenter } from "../features/tasks/TaskCenter";
import type { LibraryState } from "../core/useLibraryData";

export interface ShellContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ShellOverlayHostProps {
  contextMenu: ShellContextMenuState | null;
  fileOps: FileOpsController;
  library: LibraryState;
  recentOpsOpen: boolean;
  taskPaletteOpen: boolean;
  taskCenterOpen: boolean;
  onCloseContextMenu: () => void;
  onCloseRecentOps: () => void;
  onCloseTaskPalette: () => void;
  onCloseTaskCenter: () => void;
  onOpenTaskCenter: () => void;
  onRefreshRecentOps: () => void;
}

export function ShellOverlayHost({
  contextMenu,
  fileOps,
  library,
  recentOpsOpen,
  taskPaletteOpen,
  taskCenterOpen,
  onCloseContextMenu,
  onCloseRecentOps,
  onCloseTaskPalette,
  onCloseTaskCenter,
  onOpenTaskCenter,
  onRefreshRecentOps
}: ShellOverlayHostProps) {
  const renameTarget = fileOps.rename.target;
  const moveTarget = fileOps.move.target;
  const removeTarget = fileOps.remove.target;

  return (
    <>
      <TaskOverlay mode="compact" onClose={onCloseTaskPalette} open={taskPaletteOpen}>
        <TaskPanel
          onClose={onCloseTaskPalette}
          onOpenTaskCenter={onOpenTaskCenter}
          scanActive={library.scanActive}
          tasks={library.tasks}
        />
      </TaskOverlay>

      <TaskOverlay mode="center" onClose={onCloseTaskCenter} open={taskCenterOpen}>
        <TaskCenter
          busyTaskIds={library.busyTaskIds}
          onCancel={library.cancelTask}
          onClose={onCloseTaskCenter}
          onRefresh={() => void library.refreshTasks()}
          onRetry={library.retryTask}
          scanActive={library.scanActive}
          tasks={library.tasks}
        />
      </TaskOverlay>

      {recentOpsOpen ? (
        <LiquidGlassSurface
          as="div"
          className="floating-popover recent-ops-drawer"
          data-compact-popover="recent"
          data-compact-popover-root="recent"
          interactive
          scrollable
          tone="elevated"
        >
          <RecentOpsPanel
            loading={library.recentOpsLoading}
            onDismiss={onCloseRecentOps}
            onRefresh={onRefreshRecentOps}
            ops={library.recentOps}
          />
        </LiquidGlassSurface>
      ) : null}

      {contextMenu ? (
        <ContextMenu
          items={contextMenu.items}
          onClose={onCloseContextMenu}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      ) : null}

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
    </>
  );
}
