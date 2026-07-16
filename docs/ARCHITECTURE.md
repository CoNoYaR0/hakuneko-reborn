# Architecture — Current (Legacy) State

Analysis of the existing codebase, verified against the source on 2026-07-14.
Upstream: https://github.com/manga-download/hakuneko — wiki: Developer-Manual.

## Big picture

HakuNeko is split into two coupled projects living in one repo:

```
┌────────────────────────────────────────────────────────────┐
│ Electron client (src/app)  — Electron 8.3.4, plain JS      │
│  main.js → App.js → ElectronBootstrap.js                   │
│  • registers custom protocols: hakuneko://cache/,          │
│    hakuneko://plugins/                                     │
│  • CacheDirectoryManager: downloads/updates the web app    │
│    from the release server into a local cache              │
│  • Configuration{Linux,Windows,Darwin}.js: per-OS paths    │
│  • Updater / UpdateServerManager: rolling web-app updates  │
├────────────────────────────────────────────────────────────┤
│ Web application (src/web) — the real app                   │
│  index.html → Polymer frontends → mjs engine               │
│  • lib/hakuneko/frontend@classic-light|dark: Polymer UI    │
│    (app, bookmarks, chapters, connectors, jobs, mangas,    │
│     pages, menu, settings … as .html components)           │
│  • mjs/engine/: core logic (see below)                     │
│  • mjs/connectors/: 1,334 source plugins + 45 templates    │
│  • mjs/videostreams/: video site support                   │
└────────────────────────────────────────────────────────────┘
```

In production the client fetches the web app from a rolling-release server and hosts it
from a local cache (`hakuneko://cache/`). In dev, `npm start` points the cache at `./src/web`.

## Engine (`src/web/mjs/engine/`)

| Module | Role |
|---|---|
| `Connector.mjs` | Base class for all sources. Holds `id`, `label`, `tags`, `url`, request options; manga-list caching via `Engine.Storage`; `initialize()` warms the site via `fetchUI` (Cloudflare). Uses **global `Engine.*` singletons** (a TODO in the code admits DI is missing). |
| `Connectors.mjs` | Registry. On startup dynamically `import()`s **all** connector files from `hakuneko://cache/mjs/connectors/` + user plugins from `hakuneko://plugins/` + 3 system connectors (Bookmark, Folder, Clipboard). Duplicate-ID guard, sorted by label. |
| `Request.mjs` | All HTTP. Key method **`fetchUI(request, script, timeout, images)`**: opens a **hidden Electron BrowserWindow**, loads the page, waits for scraping checks (Cloudflare / DDoS-Guard detection script), optionally executes an injected script in page context, returns the result. Also uses `webContents.session.webRequest.onBeforeRequest` and the `debugger` API. This is the anti-bot workhorse — **hard Electron dependency**. |
| `DownloadManager.mjs` / `DownloadJob.mjs` | Queue + jobs for chapter/page downloads. |
| `Storage.mjs` | File I/O through Electron (manga lists as `.json` per connector, chapters as folders/cbz/pdf/epub via generators). |
| `EbookGenerator.mjs` / `ComicInfoGenerator.mjs` | Export formats (epub, ComicInfo.xml). Binaries: ffmpeg, imagemagick, kindlegen shipped as npm packages. |
| `BookmarkManager.mjs` / `BookmarkImporter.mjs` / `ChaptermarkManager.mjs` | Bookmarks & "new chapter" tracking. |
| `Blacklist.mjs`, `Cookie.mjs`, `HeaderGenerator.mjs`, `Enums.mjs`, `Settings.mjs`, `HistoryWorker.mjs`, `DiscordPresence.mjs`, `InterProcessCommunication.mjs` | Support modules; IPC bridges web↔Electron. |

## Connectors (sources)

The most important fact in the codebase:

- **1,334 connector files**, but **~1,034 (77%) are pure configuration** extending one of
  **45 templates**. Distribution of template use:
  `WordPressMadara 439 · WordPressMangastream 192 · FoolSlide 60 · MangaReaderCMS 43 ·
  WordPressMadaraNovel 33 · SinMH 18 · CoreView 16 · SpeedBinb 15 · Genkan 12 · FlatManga 12 · …`
- A typical concrete connector is ~10 lines:

```js
import MangaNel from './MangaNel.mjs';
export default class MangaKakalot extends MangaNel {
    constructor() {
        super();
        super.id = 'mangakakalot';
        super.label = 'MangaKakalot';
        this.tags = [ 'manga', 'webtoon', 'english' ];
        this.url = 'https://www.mangakakalot.gg';
    }
}
```

- Templates carry the real logic as **overridable CSS-selector fields + request builders**
  (e.g. `WordPressMadara`: `queryMangas`, `queryChapters`, `queryPages`, admin-ajax pagination).
- ~300 connectors have genuinely custom logic (API-based sites, encryption, image descrambling).

### User plugins (existing extension point)

`Configuration.js` defines `{userData}/hakuneko.plugins`; `ElectronBootstrap.js` maps it to the
`hakuneko://plugins/` protocol; `Connectors.initialize()` loads every `.mjs` in it at startup.
**So sources can already be added without touching the app — just by dropping a file in a folder.**
The one-click system builds directly on this (see ADDING-SOURCES.md).

## UI (legacy)

Polymer 2-era HTML imports (`src/web/lib/hakuneko/frontend@classic-light/*.html`), webcomponentsjs
polyfills, `iron-list` virtual scrolling, ShadyCSS. Two frontends (light/dark) that are near-duplicate
code. Styling and logic are interleaved in single-file components. No build-time typing, no
component tests.

## Known pain points (why we modernize)

1. **Startup cost**: all 1,334 connector modules are imported before the app is usable.
2. **Dead framework**: Polymer/HTML-imports are deprecated; contributions require archaeology.
3. **Electron 8 (2020)**: security patches long ended; poor Wayland/HiDPI behavior on modern Linux.
4. **Adding a source requires writing a JS class**, PR, review, deploy — even when it's 4 fields.
5. **Global singletons** (`Engine.*`) instead of DI make testing hard (acknowledged in code TODO).
6. **Rolling web-app updates** need server infrastructure; the third "content delivery" component
   is private, so the update pipeline is not fully reproducible from the public repo.
