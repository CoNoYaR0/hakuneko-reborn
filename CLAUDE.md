# CLAUDE.md — HakuNeko Reborn

**HakuNeko Reborn** (package `hakuneko-reborn`, currently `1.0.0-alpha.0`) is a modern
rebuild of [HakuNeko](https://github.com/manga-download/hakuneko), the manga downloader.
The app lives at the **repo root** (`src/`, `test/`, `resources/`, …). Credit to upstream is
prominent and deliberate — see [README.md](README.md).

Naming: product = "HakuNeko Reborn", slug/binary/config-dir = `hakuneko-reborn`. (The
`window.hakuneko` preload API keeps its short name — it's an internal surface, not branding.)

**The legacy HakuNeko tree is no longer in this repo.** It was porting reference and has
served its purpose; carrying 3,195 files / 33 MB of dead code (plus upstream's stray
`key.pem`) into every clone wasn't worth it. Get it when you need it:
`git fetch upstream` (`https://github.com/manga-download/hakuneko.git`). Anything in the docs
below that cites a `src/web/mjs/...` path is describing **legacy** code, found there — not
this repo.

The three project goals, in order:

1. **Modern, fast UI** — replace the Polymer-era frontend with a modern stack (Linux-first, Windows supported).
2. **One-click source management** — add or remove a manga source from the UI with a click, no coding required.
3. **Performance** — faster startup (don't load 1,334 connector modules eagerly), faster lists, faster downloads.

## Read these first

| Doc | What it covers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the current (legacy) app actually works — engine, connectors, IPC, scraping |
| [docs/MODERNIZATION.md](docs/MODERNIZATION.md) | Target stack, decisions and their reasons, migration strategy |
| [docs/ADDING-SOURCES.md](docs/ADDING-SOURCES.md) | The one-click add/remove source design (Source Studio) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased plan with concrete checklists — pick up work here |
| [docs/PARITY.md](docs/PARITY.md) | Legacy vs Reborn feature-by-feature; keep/drop decisions; formats; custom-connector coverage |
| [docs/MIGRATION.md](docs/MIGRATION.md) | How legacy users bring bookmarks over to Reborn |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | How to run/lint/test the legacy app; pitfalls |

## Key facts about LEGACY (verified by reading its source; it now lives at `upstream`)

These are the findings the port was built on. Paths refer to the upstream repo.

- **Two components**: `src/app` = Electron 8.3.4 shell; `src/web` = the actual application
  (loaded from a rolling-release web server in production, from disk in dev).
- **UI**: Polymer web components in `src/web/lib/hakuneko/frontend@classic-light|dark`.
- **Engine**: `src/web/mjs/engine/` — `Connector.mjs` (base class), `Connectors.mjs` (registry),
  `DownloadManager.mjs`, `Storage.mjs`, `Request.mjs`.
- **Sources = connectors**: 1,334 `.mjs` files in `src/web/mjs/connectors/`, 45 templates in
  `connectors/templates/`. **~77% of connectors are pure config** — a ~10-line subclass of a
  template setting only `id`, `label`, `tags`, `url` (439× WordPressMadara, 192× WordPressMangastream,
  60× FoolSlide, 43× MangaReaderCMS, …). Only ~300 have custom scraping logic.
- **User plugins already exist**: `.mjs` files in `{userData}/hakuneko.plugins` are served at
  `hakuneko://plugins/` and registered at startup (`Connectors.initialize()`). This is the natural
  extension point for one-click sources.
- **Cloudflare/DDoS-Guard bypass is Electron-dependent**: `Request.mjs#fetchUI` renders pages in
  hidden `BrowserWindow`s, uses `webRequest`/`debugger` APIs, and injects scripts. Any new stack
  must preserve an equivalent capability → stay on (modern) Electron; Tauri/webviews won't cut it.

## Conventions for this project

- TypeScript everywhere, Vite build, latest stable Electron.
- Source definitions are **declarative JSON** (template + config), not JS classes. See
  [docs/ADDING-SOURCES.md](docs/ADDING-SOURCES.md).
- The engine graph must stay **electron-free** so vitest can import it: import `RequestBridge`
  as a *type* only, and keep electron-dependent helpers (e.g. `challenge.ts`) in their own module.
- Before building or reviewing any UI, use the **ui-ux-pro-max skill**
  (`.claude/skills/ui-ux-pro-max/SKILL.md`) — it provides the design system, palettes, typography
  and UX checklists for this project. Requires Python 3 for its search scripts.
  **Not committed** (third-party, ships no license — see `.gitignore`). Install it into
  `.claude/skills/` from <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>.
- Update the checkboxes in [docs/ROADMAP.md](docs/ROADMAP.md) as work completes; keep docs in sync
  with reality.

## Commands (run from repo root)

```bash
npm install
npm run dev          # electron-vite dev with HMR
npm run typecheck    # tsc (main/shared) + svelte-check (renderer) — both must be 0 errors
npm test             # vitest
npm run build        # bundle to out/
npm run dist:linux   # AppImage + deb + rpm
npm run dist:win     # NSIS + portable
```

Requires Node 22+. Verification modes that boot the real app without the UI:

```bash
electron . --smoke <url>              # fetch a page through the anti-bot bridge
electron . --smoke-source <id>        # run a source end-to-end (mangas → chapters → pages)
electron . --smoke-download <id> [format]   # download a chapter (cbz|folder|pdf|epub)
electron . --smoke-detect <url>       # Source Studio auto-detection
electron . --verify-catalog [--apply] # functionally test every catalog source
```

Gotcha: `npx` gets gated by the safety classifier in some environments — invoke tools directly
(`node ./node_modules/vitest/vitest.mjs run`, `node ./node_modules/.bin/svelte-check`).
