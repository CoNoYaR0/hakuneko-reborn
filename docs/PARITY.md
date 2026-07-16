# Parity with legacy HakuNeko

How HakuNeko Reborn compares to the legacy Electron/Polymer app (`src/`), and the
explicit keep / drop / replace decisions. "Legacy" = HakuNeko 6.x.

## Feature parity

| Legacy feature | Reborn status | Notes |
|---|---|---|
| Browse a source's manga list | ✅ Kept | Virtualized list (50k+ rows), 24h cache |
| Chapters + pages | ✅ Kept | Per-source engine; adaptive fallback |
| Download to **CBZ** | ✅ Kept | Default format |
| Download to **image folder** | ✅ Kept | |
| Download to **PDF** | ✅ Kept | Embeds JPEG/PNG pages (see *Formats* below) |
| Download to **EPUB** | ✅ Kept | Preserves every image format |
| Bookmarks / favourites | ✅ Kept | + legacy import/export (`{title,key}`) |
| "New chapter" marks | ✅ Kept | Chapter-seen tracking in Storage |
| Adult-content flag | ✅ **Improved** | Hidden by default + 18+ age gate (child-safety) |
| Ad/tracker **Blacklist** | ✅ Kept | Network-layer blocker, toggle in Settings |
| Rate limiting (connector locks) | ✅ Replaced | Per-host concurrency limit (Settings) |
| Cloudflare / DDoS-Guard bypass | ✅ **Improved** | Solve-once-per-session anti-bot window |
| 1,334 connectors | ➖ Replaced | 210 verified JSON sources + adaptive + built-ins |
| Custom (code) connectors | ✅ Replaced | Built-in providers + user code plugins (below) |
| One-click **add/remove source** | ✅ **New** | Source Studio (detect → test → save) |
| Auto-update | ✅ **New** | electron-updater (Phase 5) |
| Packaging (AppImage/deb/rpm/NSIS) | ✅ Kept | electron-builder (Phase 5) |
| **Video / anime streaming** | ❌ **Dropped** | See below |
| Polymer web UI, rolling web server | ❌ Replaced | Svelte 5 + local renderer |

### Dropped: video / anime streaming

Legacy HakuNeko had a handful of anime/video connectors (HLS/`m3u8` stream
downloads). Reborn is **manga-only** by deliberate scope: the entire modernization
was framed around manga sources, the value (one-click sources, anti-bot,
adaptive extraction) is manga-shaped, and a video subsystem is a large,
separate concern. Not planned. If it's ever wanted it would be a new subsystem,
not a port.

## Formats

| Format | Image types | Best for |
|---|---|---|
| `.cbz` (default) | all | Tachiyomi/Komga/CDisplayEx readers |
| Folder | all | Direct file access, re-processing |
| `.epub` | all (JPEG/PNG/GIF/WebP/AVIF) | E-readers, single portable file |
| `.pdf` | JPEG/PNG (+ whatever Electron's `nativeImage` can transcode) | Universal viewing/printing |

**PDF note:** pages are embedded losslessly when they are JPEG or PNG (the
scanlation norm). WebP pages — increasingly common — can't be embedded by the
PDF library and are skipped (counted, logged). For WebP-heavy sources use `.cbz`
or `.epub`, which carry the original files untouched. This is an honest library
limitation, not a bug.

## Custom connectors → built-ins + code plugins

Legacy shipped ~300 connectors with real scraping logic (not pure template
config). Reborn covers them three ways, in order of preference:

1. **Adaptive extractor** (`engine/templates/Adaptive.ts`) — structure-based, no
   fixed selectors, with runtime self-healing. Handles the *majority* of the old
   custom HTML connectors without any per-site code.
2. **First-party built-in providers** (`engine/builtins/`) — for sources that are
   an **API, not HTML**, so no template or adaptive extractor can drive them.
   Trusted, bundled, typechecked, un-gated:
   | Built-in | Why it needs code |
   |---|---|
   | **MangaDex** | JSON API (`api.mangadex.org`) + MangaDex@Home image servers. Child-safe: restricted to `safe`/`suggestive` content ratings. |
3. **User code plugins** (`engine/CodePlugin.ts`) — the escape hatch for anything
   else: a `.mjs` the user installs from a local file behind a security warning.
   Same `create(ctx)` contract as a built-in.

### Not yet ported (as-needed)

The long tail of site-specific legacy connectors is intentionally **not**
hand-ported — adaptive extraction covers most, and porting ~300 mostly-redundant
files by hand isn't worth it. Add more built-ins (for API sites) or code plugins
(for descrambled-image sites) on demand. Known gap: JS-SPA readers that build
the page from a UUID API after load (e.g. some `astral-manga`-style readers) can
still yield 0 pages adaptively and would need a code plugin.

## Migration

Legacy users import their library via **Library → Import favourites** (reads the
legacy `bookmarks.json` `{title,key}` shape). See [MIGRATION.md](MIGRATION.md).
