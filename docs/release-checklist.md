# Megle Release Checklist

This checklist drives a clean release of Megle from the master branch. The goal is a
demoable, packaged Windows desktop build plus the Web/Docker artifacts. Run it
end-to-end, in order. Anyone who is not the original author should be able to follow it.

## 1. Pre-release verification

Run from the repo root.

```bash
npm test
npm --workspace @megle/web run build
npm --workspace @megle/desktop run build
cargo build --release -p megle-core
```

Expected:

- `npm test` is green (structure + contracts + schema + typecheck + cargo test).
- Web build emits `apps/web/dist/` without TypeScript or Vite errors.
- Desktop build emits `apps/desktop/dist/main.js` and `apps/desktop/dist/preload.cjs`.
- `cargo build --release -p megle-core` produces `target/release/megle-core[.exe]`.

If any step fails, stop and fix before continuing. Never edit the contract or schema to
"fix" a check; update the implementation to match the contract.

## 2. Manual smoke

Run `npm run dev` and walk through every item in this list. Capture broken behavior
as a follow-up issue rather than patching during release prep.

- [ ] Add a 1k+ file root via the sidebar input or the folder picker.
- [ ] Scan completes; the Task Center shows succeeded scan and thumbnail tasks.
- [ ] Browse the folder tree and the media grid; switching folders re-scopes the grid.
- [ ] Preview switching is responsive — left/right neighbors prefetch.
- [ ] Rename / Move / Recycle work from the context menu; recent ops drawer updates.
- [ ] Tag / rate / favorite a file; search composes filters; chips clear filters.
- [ ] Cancel a running scan from Task Center; retry it; final state is succeeded.
- [ ] Disable / re-enable a registered plugin; the badge reflects state.
- [ ] Settings page shows ffmpeg badge, database path, and plugins folder path.
- [ ] Onboarding hero appears on a fresh profile (no roots) and "Choose folder" opens
      the native picker (or focuses the sidebar input in browser-only mode).
- [ ] Frameless chrome — minimize / maximize / close work; the topbar is draggable;
      window position and maximized state restore on next launch.
- [ ] Keyboard shortcuts behave: F2 rename, Delete recycle, Shift+Delete permanent
      delete, Ctrl+F focuses search, Esc clears selection.

### 2.1 Automated real-photo smoke (recommended)

Use this when you don't want to click through the smoke list manually. It exercises
the entire `Electron → Core → SQLite → thumbnail worker → preload bridge → React grid`
path against a real photo directory and reports the exact UI state via CDP.

```bash
# 1. Clean DB so we hit the cold-start path.
rm -rf .data

# 2. Launch dev with auto-add-root + Chrome DevTools Protocol port.
MEGLE_AUTO_ADD_ROOT="<absolute path to a real photo folder>" \
  MEGLE_REMOTE_DEBUG=1 \
  npm run dev

# 3. After the window opens, in another shell:
WS=$(curl -sS http://127.0.0.1:9222/json \
  | python -c "import json,sys; print([p for p in json.load(sys.stdin) if p['type']=='page'][0]['webSocketDebuggerUrl'])")
node tools/dev/cdp-inspect.mjs "$WS"
```

The CDP inspector prints a one-liner JSON: `hasBridge`, `coreUrl`, `hasToken`,
tile counts (`ready` / `loading` / `failed`), `<img>` element count, and the
sidebar's roots subtitle. A healthy run is `hasBridge: true`, `hasToken: true`,
non-zero `tiles_ready`, and an equal number of `imgs` (each ready tile renders
one real `<img class="tile-thumb-image">`).

If the inspector reports `hasBridge: false`, the preload script crashed — check
that `apps/desktop/dist/preload.cjs` exists and is loaded by the BrowserWindow.

## 3. Release artifacts

1. Bump versions in lockstep:
   - `package.json` (root) — `version`
   - `apps/web/package.json` — `version`
   - `apps/desktop/package.json` — `version`
   - `crates/core/Cargo.toml` — `[package].version`
2. Commit the version bump:
   ```bash
   git add package.json apps/web/package.json apps/desktop/package.json crates/core/Cargo.toml
   git commit -m "chore(release): vX.Y.Z"
   ```
3. Tag the release:
   ```bash
   git tag -a vX.Y.Z -m "Megle vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
4. Create a GitHub release on the new tag and upload the built artifacts:
   - `target/release/megle-core[.exe]`
   - `apps/desktop/dist/` packaged via `electron-builder` (or the chosen packager)
   - `apps/web/dist/` zipped for static hosting
5. Smoke the released artifacts on a clean Windows machine before announcing.

## 4. Post-release

- Update `docs/README.md` "Current Work" if the next phase changes scope.
- Open follow-up issues for items deferred during smoke testing.
- Reset the development branch to track the next milestone.
