# Megle Liquid Glass Interaction Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the current Phase 10 UI from an early functional layout to a consistent liquid-glass desktop product surface across windows, controls, menus, dialogs, task panels, settings, plugins, and the library workbench.

**Architecture:** Keep the existing Electron shell, React renderer, and Rust Core API boundaries. Implement this completion slice as a verification-backed design-system pass over the current app shell: Electron owns native acrylic material, React/CSS owns glass tokens, global interaction feedback, and layer-specific styling.

**Tech Stack:** Electron 33, React 18, TypeScript, Vite, CSS variables, Lucide, Rust Core, SQLite.

---

## Acceptance Bar

- The Windows desktop window uses a transparent acrylic material while retaining the self-drawn frameless chrome.
- The React app uses one liquid-glass token set for canvas, panels, controls, elevated surfaces, borders, blur, shadows, and mouse interaction feedback.
- All operable controls have visible hover, active, focus-visible, disabled, and pointer behavior unless a component intentionally overrides it with a stronger state.
- Main control layers use glass styling: topbar, sidebar, toolbar, inspector, and task panel.
- Floating layers use elevated glass styling: context menu, sort menu, dialogs, recent operations drawer, plugin details, settings sections, and empty-state cards.
- The media grid and preview content remain stable dark content surfaces without persistent large-area blur over thumbnails.
- The root test suite includes a UI design boundary check so future work cannot silently regress the liquid-glass baseline.

## Task 1: Guard The Design Contract

**Files:**

- Modify: `D:/Megle/package.json`
- Create: `D:/Megle/tools/checks/validate-ui-design.mjs`

- [x] **Step 1: Add a fast UI design validation script**

Add `tools/checks/validate-ui-design.mjs` to check Electron acrylic settings, liquid-glass CSS tokens, global interactive selectors, glass control layer selectors, elevated layer selectors, and custom window chrome drag/no-drag regions.

- [x] **Step 2: Wire the check into root verification**

Add `check:ui-design` to `package.json` and include it in `npm test`.

- [x] **Step 3: Verify the check fails before implementation**

Run:

```powershell
npm run check:ui-design
```

Expected before implementation: failure messages for missing acrylic settings, missing tokens, missing global interaction selectors, and missing glass layer styles.

## Task 2: Enable Windows Acrylic Desktop Glass

**Files:**

- Modify: `D:/Megle/apps/desktop/src/main.ts`

- [x] **Step 1: Keep the existing frameless shell**

Preserve:

```ts
frame: false,
titleBarStyle: "hidden",
```

- [x] **Step 2: Add Windows acrylic and transparent window background**

Set the Electron `BrowserWindow` options to include:

```ts
backgroundMaterial: "acrylic",
transparent: true,
backgroundColor: "#00000000",
```

- [x] **Step 3: Verify desktop type safety**

Run:

```powershell
npm run check:desktop
```

Expected: desktop boundary check and TypeScript check pass.

## Task 3: Apply Layered Liquid-Glass Tokens And Control States

**Files:**

- Modify: `D:/Megle/apps/web/src/styles.css`

- [x] **Step 1: Replace flat root surface values with liquid-glass tokens**

Add CSS variables for:

```css
--glass-canvas;
--glass-panel;
--glass-control;
--glass-elevated;
--glass-border;
--glass-blur;
--glass-elevated-blur;
--glass-shadow;
--interactive-hover;
--interactive-active;
```

Keep existing `--surface-*`, `--line`, `--text-*`, `--accent`, and `--danger` aliases so current component CSS remains compatible.

- [x] **Step 2: Add global operable-control mouse and keyboard feedback**

Add global selectors for:

```css
:where(button, [role="button"], input, select, textarea)
:where(button, [role="button"]):hover:not(:disabled)
:where(button, [role="button"]):active:not(:disabled)
:where(button, [role="button"], input, select, textarea):focus-visible
```

The rules must cover transition, cursor, hover lift/highlight, pressed transform, focus ring, and disabled behavior.

- [x] **Step 3: Style persistent control layers as glass**

Apply `backdrop-filter: blur(var(--glass-blur)) saturate(1.45)` and `box-shadow: var(--glass-shadow)` to:

```css
.topbar,
.library-sidebar,
.task-panel,
.toolbar,
.inspector-panel
```

- [x] **Step 4: Style floating layers as elevated glass**

Apply `backdrop-filter: blur(var(--glass-elevated-blur)) saturate(1.5)` to:

```css
.context-menu,
.dialog,
.dialog-panel,
.recent-ops-drawer,
.sort-menu-list
```

Also align plugin detail panes, settings sections, task cards, plugin cards, and empty-state cards with the same glass token language.

- [x] **Step 5: Preserve content-stage performance**

Keep `.grid-surface`, `.virtual-grid`, `.media-tile`, `.tile-thumb`, and `.preview-stage` as stable content surfaces without broad persistent `backdrop-filter`.

## Task 4: Verify And Smoke Test

**Files:**

- Verify current workspace.

- [x] **Step 1: Run targeted checks**

Run:

```powershell
npm run check:ui-design
npm run check:desktop
npm run check:web
```

Expected: all targeted checks pass.

- [x] **Step 2: Run full repository verification**

Run:

```powershell
npm test
npm --workspace @megle/web run build
npm --workspace @megle/desktop run build
```

Expected: all commands exit 0.

- [x] **Step 3: Launch a desktop smoke run with the provided image root**

Run the app with:

```powershell
$env:MEGLE_AUTO_ADD_ROOT='C:\Users\84460\OneDrive\图片\动漫背景图'
npm run dev
```

Expected: Electron opens the Megle shell, auto-adds the test root if Core accepts it, and displays the updated liquid-glass shell and controls.

## Task 5: Record State And Commit

**Files:**

- Modify: `D:/Megle/.codex/memory.md`
- Modify: `D:/Megle/docs/implementation-roadmap.md`

- [x] **Step 1: Update project memory**

Record that Phase 10 UI completion now includes the acrylic Electron shell, liquid-glass CSS contract, global control interactions, and UI design validation check.

- [x] **Step 2: Update the roadmap**

Record that Phase 10 hardening includes a design-system enforcement pass, not just feature completion.

- [x] **Step 3: Commit the completed slice**

Run:

```powershell
git status --short
git add package.json tools/checks/validate-ui-design.mjs apps/desktop/src/main.ts apps/web/src/styles.css docs/superpowers/plans/2026-05-18-megle-liquid-glass-interaction-completion.md docs/implementation-roadmap.md
git commit -m "feat: complete liquid glass interaction pass"
```

Note: `.codex/memory.md` is intentionally ignored by git in this repository, so it is updated as local project memory rather than added to the commit.
