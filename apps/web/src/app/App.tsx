import { Images, ListChecks, Package, Settings } from "lucide-react";
import { useState } from "react";
import { useLibraryData } from "../core/useLibraryData";
import { LibrarySidebar } from "../features/library/LibrarySidebar";
import { LibraryView } from "../features/library/LibraryView";
import { TaskCenter } from "../features/tasks/TaskCenter";
import { TaskPanel } from "../features/tasks/TaskPanel";

type AppView = "library" | "tasks" | "plugins" | "settings";

const tabs = [
  { id: "library", label: "Library", icon: Images },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "plugins", label: "Plugins", icon: Package },
  { id: "settings", label: "Settings", icon: Settings }
] satisfies Array<{ id: AppView; label: string; icon: typeof Images }>;

export function App() {
  const [activeView, setActiveView] = useState<AppView>("library");
  const library = useLibraryData();

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
      </header>

      <LibrarySidebar library={library} />

      {activeView === "library" ? <LibraryView library={library} /> : null}
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
    </main>
  );
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
