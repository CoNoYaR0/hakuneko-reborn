# Development Guide

## Workspace layout (on this machine)

| Path | What |
|---|---|
| `~/Desktop/hakuneko` | This repo — the app at the root, docs in `docs/` |
| `~/Desktop/hakuneko-wiki` | Clone of the upstream wiki (Developer-Manual.asciidoc, Home.asciidoc) |
| `~/Desktop/ui-ux-pro-max-skill` | Upstream clone of the UI/UX skill (installed copy lives in `.claude/skills/ui-ux-pro-max/`) |

## Running the legacy app

```bash
cd ~/Desktop/hakuneko
npm install            # also runs postinstall → npm install in src/app
npm start              # electron . --update-url=DISABLED --cache-directory=./src/web
```

Notes / pitfalls:

- **Electron 8.3.4 (2020)**: on modern Linux (Wayland, newer glibc/sandbox rules) you may need
  `--no-sandbox` or `ELECTRON_DISABLE_SANDBOX=1` to launch, and X11/XWayland
  (`GDK_BACKEND=x11`) if the window comes up blank. These flags are for the *legacy* app only.
- `--update-url=DISABLED --cache-directory=./src/web` makes the client serve the web app
  straight from the working tree instead of the release server — that's the whole dev loop
  (edit file → reload window).
- `key.pem` in the repo root is used by the build scripts for signing the web-app bundle;
  not needed for `npm start`.
- Lint: `npm run lint` (separate configs for `src/app` CommonJS and `src/web/mjs` ES2020).
- Tests: `npm test` (unit); `npm run test:e2e` hits live manga sites — slow, flaky, needs network.

## Legacy code map (for spelunking)

- Electron shell: `src/app/main.js` → `App.js` → `ElectronBootstrap.js` (protocols, window)
- Engine: `src/web/mjs/engine/` — start with `Connectors.mjs` (registry) and `Connector.mjs` (base)
- Anti-bot fetching: `src/web/mjs/engine/Request.mjs` (`fetchUI`)
- Templates (the scraping logic that powers 77% of sources): `src/web/mjs/connectors/templates/`
- Sample trivial connector: `src/web/mjs/connectors/MangaKakalot.mjs`
- UI components: `src/web/lib/hakuneko/frontend@classic-light/*.html`
- User plugin dir: `Configuration.js` → `{userData}/hakuneko.plugins` → `hakuneko://plugins/`

## Running the app

```bash
cd ~/Desktop/hakuneko
npm install
npm run dev            # vite + electron, HMR
npm run test           # vitest
npm run build          # electron-builder (AppImage/deb/rpm on Linux, NSIS on Windows)
npm run codemod        # regenerate resources/catalog.json from legacy connectors
```

### Verifying the engine end-to-end (no UI)

```bash
npm run build
./node_modules/electron/dist/electron . --smoke <url>            # anti-bot page fetch
./node_modules/electron/dist/electron . --smoke-source <id>      # source: mangas→chapters→pages
./node_modules/electron/dist/electron . --smoke-download <id>    # download first chapter → cbz
```

### Catalog health checker (dead-source cleaner)

`scripts/health-check.mjs` finds and (optionally) removes dead sources from the bundled
catalog. It is **conservative by design — a source is removed only on positive proof of
death**, never on silence (timeout / DNS hiccup / bot-block / Cloudflare challenge are all
kept). Removed entries are archived to `resources/catalog-removed.json` (reversible).

```bash
node scripts/health-check.mjs                 # probe, write resources/health-report.json (no changes)
node scripts/health-check.mjs --apply         # also remove provably-dead from catalog.json
node scripts/health-check.mjs --passes 3 --concurrency 24 --timeout 12000
```

Verdicts: `alive` / `protected` (CF/DDoS challenge) / `moved` (off-domain redirect) — all kept;
`unknown` / `tls-broken` / `origin-down` — kept for review; `nxdomain` / `parked` / `refused` /
`hijacked` (redirect to cam/malware/ad domain) — removed with `--apply` (must agree across all
passes). Always run `--passes 3+` before `--apply`: a single pass can misread a transient
`refused`/timeout as dead (learned the hard way — 1-pass wrongly flagged 2 live sites).

### Functional catalog verifier (`--verify-catalog`)

The health-check above only probes HTTP. The **functional** verifier actually runs each source
through the engine (`bridge.fetch` + structure-based manga extraction) and asks: *does this site
really serve manga?* Run it inside Electron:

```bash
npm run build
./node_modules/electron/dist/electron . --verify-catalog          # dry run → resources/verify-report.json
./node_modules/electron/dist/electron . --verify-catalog --apply  # also remove dead/unreachable
```

Verdicts (`src/main/verifyCatalog.ts`):
- `alive` — extracted a manga list → **keep**
- `protected` — hit an anti-bot challenge → **keep** (a challenge proves the site is live & legit)
- `js-shell` — responds but content is JS-rendered (SPA markers or tiny body) → **keep** (ambiguous)
- `dead` — responds with real HTML but zero manga and no anti-bot → **removed** with `--apply`
- `unreachable` — no HTTP response at all → **removed** with `--apply`

Opens no windows (plain fetch only), so it runs unattended across 300+ sources in a few minutes.
Removed entries are archived to `resources/catalog-removed.json` (reversible).

## Working with Claude Code on this repo

- Read `CLAUDE.md` first; pick tasks from `docs/ROADMAP.md` top-down.
- UI work: invoke the ui-ux-pro-max skill before designing/reviewing screens
  (`python3 .claude/skills/ui-ux-pro-max/scripts/search.py --help` for its query CLI).
- Keep `docs/` truthful — when a decision changes, edit MODERNIZATION.md in the same commit.
