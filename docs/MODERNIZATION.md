# Modernization Plan

Target: a fast, modern, Linux-first (Windows-supported) manga downloader with one-click
source management, built alongside the legacy app in `v2/` and reaching feature parity
incrementally.

## Decisions (with reasons)

| Decision | Choice | Why |
|---|---|---|
| Shell | **Electron (latest stable)** | `fetchUI` anti-bot scraping needs hidden real-Chromium windows, `webRequest` interception and the `debugger` API. Tauri/WKWebView/WebKitGTK cannot do this reliably, and Linux WebKitGTK is the least Cloudflare-capable engine of all. Modern Electron also fixes Wayland/HiDPI/portal issues that Electron 8 has. |
| Language | **TypeScript** (strict) | 1,334 untyped plugins is exactly the codebase type-checking exists for; templates get typed config interfaces. |
| Build | **Vite** + electron-builder | Instant HMR for UI work; electron-builder outputs AppImage/deb/rpm + NSIS/portable. |
| UI framework | **Svelte 5 (SvelteKit not required) or React 18** — default **Svelte** | Small runtime = faster startup and lists; the UI is form/list heavy, not ecosystem-dependent. If contributor familiarity matters more, React is acceptable; decide at Phase 1 kickoff and record it here. |
| List rendering | Virtualized lists (e.g. `@tanstack/virtual`) | Manga lists can be 50k+ entries per source. |
| Design system | Generated with the **ui-ux-pro-max** skill (`.claude/skills/ui-ux-pro-max/`) | Consistent palettes/typography/UX rules; light + dark from one token set (legacy shipped two duplicate frontends just for theming). |
| Source model | **Declarative JSON definitions + typed template engine** | 77% of sources are already pure config; JSON makes them data, enabling the one-click Source Studio, safe sharing, and hot add/remove. See ADDING-SOURCES.md. |
| Custom sources | Keep a **code escape hatch** (`.mjs`/`.ts` plugin implementing the Connector interface) | The ~300 custom connectors (APIs, descrambling) can't be pure data. |
| Updates | App updates via electron-updater; **source definitions update independently** as a data feed | Removes the bespoke rolling web-app server; sources can update daily without shipping an app release. |
| Storage | Keep folder/cbz/pdf/epub outputs; same on-disk layout as legacy | Users keep their libraries; bookmarks importable from legacy. |

## Performance targets

- Cold start < 2s to interactive (legacy imports 1,334 modules up front; v2 loads a JSON
  index and lazy-instantiates a source on first use).
- Source list, manga list, chapter list all virtualized; search-as-you-type under 16ms/frame.
- Downloads: worker-pool with per-host rate limits (preserve legacy's lock semantics).

## Linux-first, Windows supported

- Packages: AppImage + deb + rpm (+ Flatpak once stable); Windows NSIS installer + portable zip.
- XDG base dirs on Linux (`~/.config/hakuneko`, `~/.local/share/hakuneko`), proper `%APPDATA%`
  on Windows (legacy Configuration*.js already models this split — port it).
- Wayland-native (`--ozone-platform-hint=auto`), tray optional, no GPU-flag hacks.

## Migration strategy (summary — details in ROADMAP.md)

1. **v2 scaffold**: Electron latest + Vite + TS; main-process `RequestBridge` port of `fetchUI`.
2. **Engine port**: Connector interface, template engine, storage, download manager — typed,
   dependency-injected (kill the `Engine.*` globals), unit-tested.
3. **Automated connector migration**: a codemod parses the 1,034 template-based legacy connectors
   (they only set fields in a constructor — statically analyzable) and emits JSON definitions.
   The ~300 custom ones are ported opportunistically, most-used first.
4. **UI**: one themed frontend (light/dark tokens), screens: Sources, Library/Mangas, Chapters,
   Downloads/Jobs, Settings, **Source Studio**.
5. **Parity checklist + packaging + CI** (GitHub Actions matrix: ubuntu + windows).

## What we explicitly do NOT do

- No in-place refactor of `src/` (Polymer). It stays as the reference implementation.
- No Tauri port (breaks anti-bot scraping — see Decisions).
- No server-hosted rolling web app in v2; the app is self-contained, only source
  definitions update over the wire.
