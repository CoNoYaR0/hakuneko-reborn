# Roadmap

> **Note on paths:** this is a historical record. The app was originally built in a `v2/`
> subdirectory alongside the legacy tree; on 2026-07-16 the legacy code was removed and the
> app moved to the repo root. Where older entries below say `v2/foo`, read `foo`.

Work happens at the repo root.
Update checkboxes as items complete; add discoveries as new items rather than silently
changing scope. Each phase ends with something runnable.

## Phase 0 — Workspace (DONE 2026-07-14)

- [x] Clone repo + wiki, read source code
- [x] Analysis docs: ARCHITECTURE / MODERNIZATION / ADDING-SOURCES / DEVELOPMENT
- [x] CLAUDE.md project guide
- [x] Install ui-ux-pro-max skill at `.claude/skills/ui-ux-pro-max/`

## Phase 1 — v2 scaffold & request bridge (DONE 2026-07-14)

- [x] `v2/` app: Electron 43 + Vite 7 + electron-vite 5 + TypeScript 5 (strict) + Svelte 5,
      electron-builder config (AppImage/deb/rpm + NSIS/portable). Both typechecks + build green.
- [x] Main-process `RequestBridge`: port of legacy `Request.mjs#fetchUI` (hidden BrowserWindow,
      scraping-check script incl. current CF managed-challenge/Turnstile, `webRequest` header
      rewriting, per-host `HostLimiter`) with a typed IPC API (`src/shared/ipc.ts`) + preload bridge
- [x] Config module ported from `Configuration{Linux,Windows,Darwin}.js` (XDG / %APPDATA%,
      portable mode) → `src/main/config.ts`; paths resolve under `hakuneko`
- [x] Smoke test (`electron . --smoke <url>`): fetched live Cloudflare Madara + webtoon sites —
      mangaread.org 331KB/4.5s, weebcentral 256KB/1.5s, mangakakalot 214KB/1.5s
- [x] Design system via ui-ux-pro-max skill → `v2/DESIGN.md` + `theme.css` tokens (dark-first OLED,
      warm accent, Inter, focus-ring + reduced-motion)

Notes for whoever continues:
- Node is installed user-locally at `~/.local/opt/node` (v24), symlinked into `~/.local/bin`.
- Pinned versions matter: `vite ^7`, `@sveltejs/vite-plugin-svelte ^6`, `typescript ^5` —
  `latest` pulls vite 8 / TS 7 which break electron-vite 5 and svelte-check today.
- Run the app: `npm run dev`. Smoke test: `npm run build && electron . --smoke <url>`.

## Phase 2 — Engine port & source model (mostly DONE 2026-07-14)

- [x] `Template` interface + DI'd `SourceContext` (cheerio DOM + anti-bot bridge, no globals);
      ported WordPressMadara, WordPressMangastream, FoolSlide, MangaReaderCMS. Faithful port of
      legacy `createDOM` img→source rewrite (load-bearing for page selectors).
- [x] JSON source-definition schema (`resources/schemas/source-v1.json`) + hand-rolled validator
- [x] Folder-watched `SourceRegistry` (`sources/*.json` + tombstones), lazy `Source` instantiation
- [x] **Codemod** (`scripts/codemod-connectors.mjs`, AST via acorn): 1,328 legacy connectors →
      **566 JSON sources** in `resources/catalog.json` (madara 360, mangastream 123, foolslide 50,
      mrcms 33). 762 skipped (588 unsupported-template, 118 custom members) → `codemod-report.json`.
- [x] Engine wired into app: typed IPC (sources list/add/remove, mangas/chapters/pages) + preload
      + Sources UI (searchable list, one-click add/remove, manga→chapter→page browser).
- [x] **Catalog health checker** (`scripts/health-check.mjs`): conservative multi-pass dead-source
      cleaner. Removes only on positive proof (nxdomain/parked/refused/hijacked, all passes agree);
      timeouts/challenges/moves are always kept. Archives removals to `catalog-removed.json`.
      First run trimmed the catalog 566 → 359 live sources.
- [x] **Child-safety pass** (`scripts/classify-nsfw.mjs` + `src/main/engine/nsfw.ts`): removed 7
      sources hijacked into cam/nudify/ad-malware redirects; stamped `nsfw:true` on 40 adult
      sources (tag/keyword classifier, shared by registry so user-added sources are classified too).
      **Age gate**: NSFW sources hidden by default (`Settings.adultUnlocked=false`), a sidebar
      "Show adult (18+)" toggle triggers an "Are you 18+?" `AgeGateDialog` before revealing them,
      18+ badge in the list. Catalog now 352 sources (312 SFW visible + 40 gated). Tests in
      `test/nsfw.test.ts` guard the classifier and the script/engine list mirror.
- [x] Unit tests (vitest) for validator, HostLimiter, DOM helpers, all 4 templates (mocked fetch)
- [x] **Live e2e per template** (`electron . --smoke-source <id>`), all green:
      Madara mangaread 3179→6→29 · Mangastream lelmanga 152→192→312 (fetchWindow pages) ·
      MangaReaderCMS scanvf 26→81→7 · FoolSlide deathtollscans 74→3→6
- [x] **Download manager** (`src/main/download/`): sequential chapter queue + bounded page
      pool (4), referer-aware page fetch, magic-byte mime sniffing, cbz (yazl) or folder output,
      cancel/retry, live progress events. Verified e2e (`electron . --smoke-download mangaread`):
      29/29 pages → valid 11 MB cbz of real 1440×2048 JPEGs. Unit tests for sanitize/sniff/naming.
- [x] **Storage** (`src/main/Storage.ts`, DONE 2026-07-14): per-source manga-list cache
      (`{cache}/mangas/{id}.json`, 24h TTL, manual refresh), bookmarks (`{userData}/bookmarks.json`),
      chapter-seen marks for new-chapter highlighting. **Legacy bookmark import/export** (classic
      HakuNeko `{title,key}` format, round-trips). 7 unit tests (`test/storage.test.ts`).

## Phase 3 — UI (DONE 2026-07-14)

- [x] **App shell** (`App.svelte` + `store.svelte.ts`): left icon rail switching
      Sources / Library / Downloads / Settings; reactive store keeps all views in sync; active-state
      + count badges; `<nav>`/`<main>` landmarks.
- [x] Sources screen: searchable list, one-click add/remove (folder-watched, live), edit/duplicate,
      source browser (manga → chapters → pages) with **virtualized** manga list (`VirtualList.svelte`,
      dependency-free windowing, handles 50k+). Per-chapter download button.
- [x] **Library**: bookmarks across all sources (virtualized), open → chapters with **NEW** marks
      (chapters unseen since last visit), bookmark ☆/★ toggle, remove, download from library.
- [x] Downloads: full-screen job queue view + sidebar panel, progress bars, cancel/retry, clear.
- [x] **Settings**: download format (cbz/folder), per-host rate limit (wired to `HostLimiter`),
      theme (system/light/dark via `data-theme`), adult toggle, bookmark + source-pack import/export,
      code-plugin install, app paths/version.
- [x] **UX review** vs the ui-ux-pro-max checklist — every screen checked; fixes applied
      (role="status" on loaders, aria-labels on icon buttons, modal focus management + Esc,
      info never color-only, manual theme override with ≥4.5:1 contrast both modes). Documented in
      `v2/DESIGN.md` "UX review pass".
- [x] **Favorites import/export in Library** (DONE 2026-07-14): Import/Export buttons on the Library
      rail (reusing the legacy-format bookmark IPC) so favorites are shared/backed up where they live.
- [x] **Language filter on the source list** (DONE 2026-07-14): `lib/languages.ts` detects each
      source's language(s) from its `language` field + language tags; SourceList shows a language
      dropdown (with counts) that filters the list. 14 languages across the 352-source catalog;
      7 unit tests (`test/languages.test.ts`).

## Phase 4 — Source Studio (the flagship) (DONE 2026-07-14, extras completed)

- [x] **Auto-detection** (`src/main/engine/detect.ts`): fetch homepage through the bridge,
      fingerprint the template (Madara/Mangastream/FoolSlide/MangaReaderCMS markers), extract
      label (og:site_name/title), language (html lang), favicon→data URI, NSFW hint. Secondary
      probe fetches each template's list path (`/directory/`, `/changeMangaList?type=text`) when
      the homepage shows no markers — needed for FoolSlide/MRCMS whose tells aren't on the root.
      Falls back to the anti-bot window when static fetch is blocked. `rankTemplates()` is pure +
      unit-tested (`test/detect.test.ts`).
- [x] **Live test** (`src/main/engine/testSource.ts`): dry-runs an unsaved definition end-to-end
      (mangas → chapters → pages) without saving, reporting per-step ok/count/sample/error + a
      first-page thumbnail. This is the source of truth — the wizard only green-lights a source
      whose test passes, so a mis-detected or JS-gated site can't be saved broken.
- [x] **Source Studio wizard** (`SourceStudio.svelte`, replaced AddSourceDialog): paste URL →
      detected template + confidence + prefilled fields (all editable) → selector-override JSON
      accordion → live-test panel (green/red per step) → save. NSFW auto-flag surfaced + editable.
- [x] IPC `sources:detect` / `sources:test` + preload; `electron . --smoke-detect <url>` e2e.
      Verified live: mangaread (Madara) detect 100% + test 3180→2→20; scan-vf (MRCMS) detect via
      probe + test 26→81→7 (French lang auto-detected). Both typechecks + 46 vitest green.
- [x] **Element-picker** (`src/main/engine/pickElement.ts`, DONE 2026-07-14): opens the site in a
      real window with a banner; the user clicks the manga/chapter/page element and it returns a
      stable CSS selector (id, else tag+class+:nth-of-type path) into the chosen override field.
- [x] Remove / **edit** / **duplicate** source; tombstones for bundled catalog entries (all done).
- [x] **Import/export source packs** (JSON file): `registry.exportPack/importPack` + Settings UI.
- [x] **Code-plugin install with explicit warning** (`src/main/engine/CodePlugin.ts`): escape hatch
      for complex sites; `meta` + `createProvider(ctx)` contract, loaded/executed by the registry,
      installed only from a user-chosen local file behind a strong security-warning dialog (never
      from URLs). Sample plugin + 3 tests (`test/codeplugin.test.ts`) prove it executes.
- [x] **Docs: user guide** (`docs/USER-GUIDE.md`) — full walkthrough (screenshots are placeholders;
      the agent environment can't capture the Electron window — capture locally via `npm run dev`).

## Phase 5 — Packaging, auto-update, CI (DONE 2026-07-15)

- [x] **App icon** — `build/icon.png` (1024, white-cat/白猫 on accent orange) + `build/icon.ico`,
      generated with PIL; referenced by electron-builder.
- [x] **Packaging** (`electron-builder.yml`): Linux AppImage/deb/rpm + Windows NSIS/portable
      (+ mac dmg optional). **Verified: real `hakuneko-reborn-<ver>-linux-x86_64.AppImage` (128 MB)
      built locally** with a valid `latest-linux.yml` update manifest (sha512 + block map).
- [x] **Auto-update** (`src/main/updater.ts`, electron-updater): startup check (packaged + opted in),
      manual check/download/install via IPC, status broadcast to a Settings → Updates panel;
      `autoDownload` off (no surprise traffic), installs on quit. `autoUpdate` setting (default on).
- [x] **GitHub Actions**: `ci.yml` (typecheck + test + build on ubuntu + windows for PRs/pushes),
      `release.yml` (tag `v*` → build installers on both OSes → publish to GitHub Release with the
      update manifests). Release process documented in `docs/RELEASING.md`.
- [x] **Functional catalog clean** (`--verify-catalog`, Phase-4.5 work): 342 → 210 live sources.
- [x] **Security audit** → `docs/SECURITY-AUDIT.md` (PASS: all windows hardened, nav guards,
      0 npm vulns, no eval/exec, path-traversal guarded).

## Phase 6 — Parity finish (DONE 2026-07-15)

- [x] **Parity checklist** → `docs/PARITY.md` (legacy vs v2 feature table; **video/anime
      streaming explicitly dropped** — v2 is manga-only).
- [x] **PDF + EPUB export** (`download/pdf.ts`, `download/epub.ts`): EPUB (yazl) preserves
      every image format; PDF (pdf-lib) embeds JPEG/PNG losslessly, WebP/other via an injected
      Electron `nativeImage` normalizer, else skipped+counted. Wired into DownloadManager,
      Settings, and the Settings UI. **Verified live**: real .pdf (2-page reload check) and .epub
      (valid zip, mimetype-first) written from a downloaded chapter.
- [x] **Ad/tracker Blacklist** (`Blacklist.ts`): legacy's ad/tracker/malware host list ported as
      a network-layer `webRequest` blocker with a proper match-pattern engine (path-specific rules
      don't over-block whole CDNs). Installed on the shared session; Settings toggle (default on).
- [x] **Most-used custom connectors** → first-party built-in providers (`engine/builtins/`).
      **MangaDex** (JSON API + MangaDex@Home images) shipped, child-safe (safe/suggestive only).
      **Verified live**: 2000 titles → chapters (with lang+group) → pages. Long tail stays covered
      by the adaptive extractor / user code plugins (documented in PARITY.md).
- [x] **Code-signing release-ready**: `release.yml` passes CSC_LINK/CSC_KEY_PASSWORD (win) +
      APPLE_* (mac) secrets to electron-builder (auto-signs when present); documented in RELEASING.md.
- [x] **Migration guide** → `docs/MIGRATION.md` (legacy bookmark export → v2 import; per-OS paths).

Post-1.0 / as-needed (not blocking a release):
- [ ] Add signing secrets and cut the first signed Windows/macOS stable.
- [ ] More built-in providers / code plugins for specific JS-SPA readers on demand.

## Later / ideas

- Flatpak; community source-pack catalog with signing; reader mode; per-source login flows;
  canonical-domain auto-detect when adding a source
