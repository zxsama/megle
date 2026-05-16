# Megle UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared Megle UI foundation: frameless Electron chrome, a reusable desktop app shell, layered liquid-glass design tokens, and shared UI primitives that future Library, Settings, Plugins, and Tasks screens can reuse.

**Architecture:** Keep the existing `Electron main -> React renderer -> Rust Core API` split. Add two shared UI workspaces, `packages/design-tokens` and `packages/ui`, then move the current Web prototype into a reusable `app-shell` layer. The renderer stays Core-API-driven; desktop-only behavior stays in `apps/desktop`.

**Tech Stack:** Electron, React, TypeScript, Vite, Radix UI, Tailwind CSS, Lucide, TanStack Query, Zustand, CSS variables tokens.

---

## File Structure

**Create:**

- `D:/Megle/packages/design-tokens/package.json`
- `D:/Megle/packages/design-tokens/src/index.css`
- `D:/Megle/packages/design-tokens/src/index.ts`
- `D:/Megle/packages/ui/package.json`
- `D:/Megle/packages/ui/src/index.ts`
- `D:/Megle/packages/ui/src/glass-button.tsx`
- `D:/Megle/packages/ui/src/glass-input.tsx`
- `D:/Megle/packages/ui/src/glass-toolbar.tsx`
- `D:/Megle/packages/ui/src/glass-sidebar.tsx`
- `D:/Megle/packages/ui/src/inspector-panel.tsx`
- `D:/Megle/packages/ui/src/task-drawer.tsx`
- `D:/Megle/apps/web/src/app-shell/AppShell.tsx`
- `D:/Megle/apps/web/src/app-shell/WindowChrome.tsx`
- `D:/Megle/apps/web/src/app-shell/PrimarySidebar.tsx`
- `D:/Megle/apps/web/src/app-shell/ContextInspector.tsx`
- `D:/Megle/apps/web/src/app-shell/TaskDrawerHost.tsx`
- `D:/Megle/apps/web/src/features/library/LibraryPage.tsx`
- `D:/Megle/apps/web/src/features/settings/SettingsPage.tsx`
- `D:/Megle/apps/web/src/features/plugins/PluginsPage.tsx`
- `D:/Megle/apps/web/src/features/tasks/TasksPage.tsx`

**Modify:**

- `D:/Megle/package.json`
- `D:/Megle/apps/web/package.json`
- `D:/Megle/apps/desktop/src/main.ts`
- `D:/Megle/apps/desktop/src/preload.ts`
- `D:/Megle/apps/web/src/main.tsx`
- `D:/Megle/apps/web/src/app/App.tsx`
- `D:/Megle/apps/web/src/features/library/LibraryView.tsx`
- `D:/Megle/apps/web/src/styles.css`
- `D:/Megle/tools/checks/validate-structure.mjs`
- `D:/Megle/docs/README.md`
- `D:/Megle/.codex/memory.md`

**Verify With:**

- `npm test`
- `npm --workspace @megle/web run build`
- `npm --workspace @megle/desktop run build`
- `npm run dev`

### Task 1: Add Shared UI Workspaces And Dependencies

**Files:**

- Create: `D:/Megle/packages/design-tokens/package.json`
- Create: `D:/Megle/packages/ui/package.json`
- Modify: `D:/Megle/package.json`
- Modify: `D:/Megle/apps/web/package.json`
- Modify: `D:/Megle/tools/checks/validate-structure.mjs`

- [ ] **Step 1: Extend the root workspace list**

Update `D:/Megle/package.json` so the workspace list includes the two new shared UI packages.

```json
{
  "workspaces": [
    "apps/desktop",
    "apps/web",
    "packages/core-client",
    "packages/design-tokens",
    "packages/ui"
  ]
}
```

- [ ] **Step 2: Add Web-facing UI dependencies**

Update `D:/Megle/apps/web/package.json` to include the foundation UI stack.

```json
{
  "dependencies": {
    "@radix-ui/react-context-menu": "^2.2.0",
    "@radix-ui/react-dialog": "^1.1.4",
    "@radix-ui/react-slot": "^1.1.1",
    "@radix-ui/react-tooltip": "^1.1.6",
    "@megle/design-tokens": "0.1.0",
    "@megle/ui": "0.1.0"
  },
  "devDependencies": {
    "tailwindcss": "^3.4.17",
    "postcss": "^8.4.49",
    "autoprefixer": "^10.4.20"
  }
}
```

- [ ] **Step 3: Create package manifests for the shared packages**

Create the package manifests below.

```json
{
  "name": "@megle/design-tokens",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/index.css"
  }
}
```

```json
{
  "name": "@megle/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "peerDependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

- [ ] **Step 4: Tighten the structure check**

Extend `D:/Megle/tools/checks/validate-structure.mjs` so it expects the new package roots.

```js
const requiredPaths = [
  "apps/desktop",
  "apps/web",
  "packages/core-client",
  "packages/design-tokens",
  "packages/ui",
  "contracts/core-api",
  "crates/core"
];
```

- [ ] **Step 5: Install and verify**

Run:

```bash
npm install
npm test
```

Expected:

- `npm install` updates the workspace lockfile cleanly.
- `npm test` still passes the structure, client, desktop, web, schema, and Rust checks.

### Task 2: Create Layered Liquid-Glass Design Tokens

**Files:**

- Create: `D:/Megle/packages/design-tokens/src/index.css`
- Create: `D:/Megle/packages/design-tokens/src/index.ts`
- Modify: `D:/Megle/apps/web/src/main.tsx`
- Modify: `D:/Megle/apps/web/src/styles.css`

- [ ] **Step 1: Define the shared CSS variable tokens**

Create `D:/Megle/packages/design-tokens/src/index.css` with the first stable token set.

```css
:root {
  --megle-font-sans: "Geist Sans", "Segoe UI", sans-serif;
  --megle-font-mono: "JetBrains Mono", "Cascadia Code", monospace;
  --megle-bg-canvas: #0f1318;
  --megle-bg-surface: #171c22;
  --megle-glass-low: rgba(242, 248, 255, 0.08);
  --megle-glass-mid: rgba(242, 248, 255, 0.12);
  --megle-glass-high: rgba(242, 248, 255, 0.16);
  --megle-accent-primary: #80c8d4;
  --megle-accent-warn: #e0a85e;
  --megle-accent-danger: #d87a6c;
  --megle-stroke-soft: rgba(255, 255, 255, 0.12);
  --megle-shadow-glass: 0 12px 32px rgba(0, 0, 0, 0.24);
  --megle-radius-panel: 22px;
  --megle-radius-control: 14px;
  --megle-blur-low: 18px;
  --megle-blur-mid: 24px;
  --megle-motion-fast: 140ms;
  --megle-motion-normal: 220ms;
}
```

- [ ] **Step 2: Export the token package entry**

Create `D:/Megle/packages/design-tokens/src/index.ts`.

```ts
import "./index.css";

export const megleThemeVersion = "2026-05-16-ui-foundation";
```

- [ ] **Step 3: Load shared tokens before app-specific CSS**

Update `D:/Megle/apps/web/src/main.tsx`.

```ts
import "@megle/design-tokens/styles.css";
import "./styles.css";
```

- [ ] **Step 4: Strip `styles.css` back to app-specific layout rules**

Keep `D:/Megle/apps/web/src/styles.css` focused on resets and page-specific glue instead of storing the entire permanent design system.

```css
body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  font-family: var(--megle-font-sans);
  background: var(--megle-bg-canvas);
  color: #f4f7f9;
}
```

- [ ] **Step 5: Verify the web build**

Run:

```bash
npm --workspace @megle/web run typecheck
npm --workspace @megle/web run build
```

Expected:

- TypeScript passes.
- The web bundle resolves `@megle/design-tokens`.

### Task 3: Build Shared UI Primitives

**Files:**

- Create: `D:/Megle/packages/ui/src/index.ts`
- Create: `D:/Megle/packages/ui/src/glass-button.tsx`
- Create: `D:/Megle/packages/ui/src/glass-input.tsx`
- Create: `D:/Megle/packages/ui/src/glass-toolbar.tsx`
- Create: `D:/Megle/packages/ui/src/glass-sidebar.tsx`
- Create: `D:/Megle/packages/ui/src/inspector-panel.tsx`
- Create: `D:/Megle/packages/ui/src/task-drawer.tsx`

- [ ] **Step 1: Create the first UI primitive exports**

Create `D:/Megle/packages/ui/src/index.ts`.

```ts
export * from "./glass-button";
export * from "./glass-input";
export * from "./glass-toolbar";
export * from "./glass-sidebar";
export * from "./inspector-panel";
export * from "./task-drawer";
```

- [ ] **Step 2: Implement a reusable glass button**

Create `D:/Megle/packages/ui/src/glass-button.tsx`.

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";

type GlassButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "primary" | "danger";
};

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ className = "", tone = "default", ...props }, ref) => (
    <button
      {...props}
      className={`megle-glass-button megle-tone-${tone} ${className}`.trim()}
      ref={ref}
      type={props.type ?? "button"}
    />
  )
);
```

- [ ] **Step 3: Implement the shell primitives**

Create `glass-toolbar.tsx`, `glass-sidebar.tsx`, `inspector-panel.tsx`, and `task-drawer.tsx` as thin layout primitives.

```tsx
import type { HTMLAttributes } from "react";

export function GlassToolbar(props: HTMLAttributes<HTMLElement>) {
  return <header {...props} className={`megle-glass-toolbar ${props.className ?? ""}`.trim()} />;
}
```

```tsx
import type { HTMLAttributes } from "react";

export function GlassSidebar(props: HTMLAttributes<HTMLElement>) {
  return <aside {...props} className={`megle-glass-sidebar ${props.className ?? ""}`.trim()} />;
}
```

- [ ] **Step 4: Verify shared package type safety**

Run:

```bash
npm --workspace @megle/web run typecheck
```

Expected:

- The web app resolves `@megle/ui` imports without duplicate React/runtime errors.

### Task 4: Move Desktop To Frameless Chrome

**Files:**

- Modify: `D:/Megle/apps/desktop/src/main.ts`
- Modify: `D:/Megle/apps/desktop/src/preload.ts`
- Create: `D:/Megle/apps/web/src/app-shell/WindowChrome.tsx`

- [ ] **Step 1: Turn the Electron window into a frameless shell**

Update `D:/Megle/apps/desktop/src/main.ts`.

```ts
import { app, BrowserWindow, ipcMain } from "electron";

mainWindow = new BrowserWindow({
  width: 1440,
  height: 920,
  minWidth: 1100,
  minHeight: 720,
  frame: false,
  backgroundColor: "#101215",
  webPreferences: {
    preload: fileURLToPath(new URL("./preload.js", import.meta.url)),
    contextIsolation: true,
    nodeIntegration: false,
    additionalArguments: [
      `--megle-core-url=${session.baseUrl}`,
      `--megle-session-token=${session.sessionToken}`
    ]
  }
});

ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("window:close", () => mainWindow?.close());
```

- [ ] **Step 2: Expose minimal safe window controls in preload**

Update `D:/Megle/apps/desktop/src/preload.ts`.

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("megleDesktop", {
  coreUrl: readArg("--megle-core-url="),
  sessionToken: readArg("--megle-session-token="),
  controls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close")
  }
});
```

- [ ] **Step 3: Render a web-side chrome component**

Create `D:/Megle/apps/web/src/app-shell/WindowChrome.tsx`.

```tsx
import { Minus, Square, X } from "lucide-react";

export function WindowChrome() {
  return (
    <div className="window-chrome">
      <div className="window-drag-region">Megle</div>
      <div className="window-actions">
        <button onClick={() => window.megleDesktop?.controls?.minimize()}>
          <Minus size={14} />
        </button>
        <button onClick={() => window.megleDesktop?.controls?.maximize()}>
          <Square size={14} />
        </button>
        <button onClick={() => window.megleDesktop?.controls?.close()}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify desktop build and manual shell startup**

Run:

```bash
npm --workspace @megle/desktop run build
npm run dev
```

Expected:

- Desktop TypeScript passes.
- Electron opens with a frameless window and web-rendered chrome.

### Task 5: Build The Shared App Shell

**Files:**

- Create: `D:/Megle/apps/web/src/app-shell/AppShell.tsx`
- Create: `D:/Megle/apps/web/src/app-shell/PrimarySidebar.tsx`
- Create: `D:/Megle/apps/web/src/app-shell/ContextInspector.tsx`
- Create: `D:/Megle/apps/web/src/app-shell/TaskDrawerHost.tsx`
- Create: `D:/Megle/apps/web/src/features/settings/SettingsPage.tsx`
- Create: `D:/Megle/apps/web/src/features/plugins/PluginsPage.tsx`
- Create: `D:/Megle/apps/web/src/features/tasks/TasksPage.tsx`
- Modify: `D:/Megle/apps/web/src/app/App.tsx`

- [ ] **Step 1: Create the shell layout component**

Create `D:/Megle/apps/web/src/app-shell/AppShell.tsx`.

```tsx
import type { ReactNode } from "react";

type AppShellProps = {
  sidebar: ReactNode;
  toolbar: ReactNode;
  content: ReactNode;
  inspector?: ReactNode;
  tasks?: ReactNode;
};

export function AppShell({ sidebar, toolbar, content, inspector, tasks }: AppShellProps) {
  return (
    <main className="app-shell">
      {sidebar}
      <section className="workspace">
        {toolbar}
        <div className="workspace-content">{content}</div>
      </section>
      {inspector}
      {tasks}
    </main>
  );
}
```

- [ ] **Step 2: Add non-Library page templates now**

Create lightweight placeholders for Settings, Plugins, and Tasks so the shell is visibly cross-application from day one.

```tsx
export function SettingsPage() {
  return <section className="page-placeholder">Settings</section>;
}
```

```tsx
export function PluginsPage() {
  return <section className="page-placeholder">Plugins</section>;
}
```

```tsx
export function TasksPage() {
  return <section className="page-placeholder">Tasks</section>;
}
```

- [ ] **Step 3: Route `App.tsx` through the shell**

Update `D:/Megle/apps/web/src/app/App.tsx` so the renderer no longer returns the library page directly.

```tsx
import { LibraryPage } from "../features/library/LibraryPage";

export function App() {
  return <LibraryPage />;
}
```

- [ ] **Step 4: Verify typecheck and build**

Run:

```bash
npm --workspace @megle/web run typecheck
npm --workspace @megle/web run build
```

Expected:

- The app shell and placeholder pages compile cleanly.

### Task 6: Migrate The Current Library Prototype Into The Shell

**Files:**

- Create: `D:/Megle/apps/web/src/features/library/LibraryPage.tsx`
- Modify: `D:/Megle/apps/web/src/features/library/LibraryView.tsx`
- Modify: `D:/Megle/apps/web/src/styles.css`

- [ ] **Step 1: Split page orchestration from feature rendering**

Create `D:/Megle/apps/web/src/features/library/LibraryPage.tsx`.

```tsx
import { AppShell } from "../../app-shell/AppShell";
import { WindowChrome } from "../../app-shell/WindowChrome";
import { LibraryView } from "./LibraryView";

export function LibraryPage() {
  return (
    <>
      <WindowChrome />
      <LibraryView />
    </>
  );
}
```

- [ ] **Step 2: Refactor `LibraryView` to render shell regions instead of the whole page**

Update `D:/Megle/apps/web/src/features/library/LibraryView.tsx` so it produces:

```tsx
return (
  <AppShell
    sidebar={<PrimarySidebar />}
    toolbar={<LibraryToolbar />}
    content={<MediaGrid ... />}
    inspector={<ContextInspector />}
    tasks={<TaskDrawerHost />}
  />
);
```

- [ ] **Step 3: Rework CSS around shell regions**

Update `D:/Megle/apps/web/src/styles.css` so classes map to the permanent shell structure.

```css
.app-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 320px;
  min-height: calc(100vh - 44px);
}

.window-chrome {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  height: 44px;
}
```

- [ ] **Step 4: Verify the integrated shell manually**

Run:

```bash
npm run dev
```

Expected:

- The current Library prototype renders inside the new shell.
- Window controls, sidebar, workspace, inspector, and task host are visually separated.
- The media grid still works with the existing Core-backed hook.

### Task 7: Close The Foundation Loop

**Files:**

- Modify: `D:/Megle/docs/README.md`
- Modify: `D:/Megle/.codex/memory.md`

- [ ] **Step 1: Document the new UI foundation entry points**

Ensure `D:/Megle/docs/README.md` points readers to:

```md
- UI Layered Liquid Glass Design
- UI Foundation Implementation Plan
```

- [ ] **Step 2: Update project memory after the first foundation slice lands**

Append the resulting implementation status to `D:/Megle/.codex/memory.md`, including:

```md
- frameless desktop chrome foundation exists
- shared design tokens package exists
- shared UI primitives package exists
- app shell scaffolding exists for Library / Settings / Plugins / Tasks
```

- [ ] **Step 3: Run the full repository verification**

Run:

```bash
npm test
npm --workspace @megle/web run build
npm --workspace @megle/desktop run build
```

Expected:

- The full repo verification still passes.
- The UI foundation slice is documented and reproducible.
