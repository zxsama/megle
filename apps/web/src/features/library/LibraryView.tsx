import { RefreshCw } from "lucide-react";
import { FormEvent, useState } from "react";
import { useLibraryData } from "../../core/useLibraryData";
import { MediaGrid } from "../media-grid/MediaGrid";

export function LibraryView() {
  const library = useLibraryData();
  const [rootPath, setRootPath] = useState("");
  const selectedRoot = library.roots.find((root) => root.id === library.selectedRootId) ?? null;
  const visibleScanTasks = library.tasks
    .filter((task) => task.kind === "root_scan")
    .filter((task) => task.status === "pending" || task.status === "running" || task.itemsSeen > 0)
    .slice(-3)
    .reverse();

  async function submitRoot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await library.addRoot(rootPath);
    setRootPath("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Folders">
        <div className="chrome-title">Megle</div>
        <form className="root-form" onSubmit={submitRoot}>
          <input
            aria-label="Root path"
            disabled={library.addingRoot}
            onChange={(event) => setRootPath(event.target.value)}
            placeholder="D:\\Pictures"
            value={rootPath}
          />
          <button disabled={library.addingRoot || rootPath.trim().length === 0} type="submit">
            Add
          </button>
        </form>
        <div className="tree-list" role="tree">
          {library.roots.map((root) => (
            <button
              className={root.id === library.selectedRootId ? "tree-item selected" : "tree-item"}
              key={root.id}
              onClick={() => library.setSelectedRootId(root.id)}
              type="button"
            >
              <span>{root.displayName}</span>
              <small>{root.rootFolderId ? "indexed" : "pending"}</small>
            </button>
          ))}
          {library.folders.map((folder) => (
            <button
              className={
                folder.id === library.selectedFolderId ? "tree-item child selected" : "tree-item child"
              }
              key={folder.id}
              onClick={() => library.setSelectedFolderId(folder.id)}
              type="button"
            >
              <span>{folder.name}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <div className="toolbar-title">{selectedRoot?.displayName ?? "Library"}</div>
            <div className="toolbar-meta">{library.media.length} media items</div>
          </div>
          <button className="icon-button" onClick={() => void library.refresh()} type="button">
            <RefreshCw size={16} />
          </button>
        </header>
        {library.error ? <div className="error-strip">{library.error}</div> : null}
        {visibleScanTasks.length > 0 ? (
          <div className="scan-strip" aria-label="Scan progress">
            {visibleScanTasks.map((task) => (
              <div className="scan-row" key={task.id}>
                <span>{task.status === "running" ? "Scanning" : task.status}</span>
                <span>{task.itemsSeen} entries seen</span>
                <span>{task.foldersSeen} folders</span>
                <span>{task.mediaFilesSeen} media</span>
                <span>{task.skippedFiles} skipped</span>
              </div>
            ))}
          </div>
        ) : library.lastScan ? (
          <div className="scan-strip">
            {library.lastScan.mediaFilesSeen} media, {library.lastScan.foldersSeen} folders
          </div>
        ) : null}
        <div className="grid-surface">
          <MediaGrid
            items={library.media}
            loading={library.loading}
            onSelect={library.setSelectedMediaId}
            selectedMediaId={library.selectedMediaId}
          />
        </div>
      </section>

      <aside className="inspector" aria-label="Metadata">
        <div className="panel-title">Metadata</div>
        {library.selectedMedia ? (
          <dl className="metadata-list">
            <dt>Name</dt>
            <dd>{library.selectedMedia.name}</dd>
            <dt>Kind</dt>
            <dd>{library.selectedMedia.kind ?? "unknown"}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(library.selectedMedia.size)}</dd>
            <dt>Thumbnail</dt>
            <dd>{library.selectedMedia.thumbnailState ?? "pending"}</dd>
          </dl>
        ) : (
          <div className="folder-placeholder">No selection</div>
        )}
      </aside>
    </main>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
