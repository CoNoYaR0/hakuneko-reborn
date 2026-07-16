# Security Audit — HakuNeko Reborn

Audit performed 2026-07-15, before Phase 5 (packaging/release). HakuNeko is an
Electron app that fetches and renders **untrusted** third-party websites, so the
threat model centres on: (a) keeping untrusted web content isolated from the
app/OS, (b) not becoming a vector to attack other sites, (c) the code-plugin
escape hatch.

## Result: PASS (with documented, accepted trade-offs)

All findings below were fixed in this pass except the two clearly-labelled
"accepted by design" items.

## Electron process hardening

Every `BrowserWindow` in the app:

| Window | nodeIntegration | contextIsolation | sandbox | webSecurity |
|---|---|---|---|---|
| Main UI (`index.ts`) | false | true | true | true |
| Scraping (`RequestBridge#fetchWindow`) | false | true | true | **true** ✓ |
| Anti-bot clearance (`RequestBridge#clearWindow`) | false | true | true | true |
| Element picker (`pickElement.ts`) | false | true | true | **true** ✓ |

- **Fixed this pass:** the scraping and element-picker windows previously ran
  `webSecurity: false`. That's now `true` everywhere — closing a narrow risk
  where a malicious source's page could make cross-origin reads against the
  shared session (e.g. another site's clearance cookie). Verified scraping still
  works (`--smoke-source` on the adaptive path: 34 → 175 → 15). Our injected
  scrapers read the page's *own* DOM (same-origin) and run in the isolated world,
  which bypasses page CSP anyway — so nothing needed the weaker setting.
- Untrusted content never has Node access (`nodeIntegration: false`, `sandbox`),
  and the preload is isolated (`contextIsolation`), exposing only the typed
  `window.hakuneko` API via `contextBridge`.

## Navigation & window-open guards (fixed this pass)

The main window now:
- `setWindowOpenHandler` → external `http(s)` links open in the **system
  browser** (`shell.openExternal`); all in-app window creation is denied. Before
  this, clicking a source/page link would spawn a new, unhardened Electron
  window.
- `will-navigate` → the app window cannot be navigated away from our own UI by
  injected content; off-origin navigations are cancelled (and opened externally
  if http(s)).

## Renderer CSP

`src/renderer/index.html`: `default-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:`. No remote script, no `unsafe-eval`. Page images render as
bridge-fetched `data:` URIs, so no external image host is contacted from the
renderer.

## Code execution surface

- **No `eval`, `child_process`, `exec`, or shell** anywhere in `src/`.
- The **only** code-execution path is **code plugins** (`CodePlugin.ts`): a
  user-chosen `.mjs` is `import()`ed and runs with Node privileges.
  - Mitigations: installed **only** from a local file the user explicitly picks,
    behind a strong security-warning dialog; **never** auto-installed from a URL
    or a source pack. JSON source definitions (the normal path) are pure data and
    cannot execute code.
  - **Accepted by design:** a code plugin the user installs is trusted code, like
    any plugin/extension model. The warning + local-file-only gate is the control.

## Input handling / path traversal

- Source ids validated against `^[a-z0-9][a-z0-9._-]*$` — no `/`, no leading `.`
  — so `sources/{id}.json` writes and tombstones cannot traverse out of the
  sources directory. Source-pack import re-validates every entry.
- Manga-list cache filenames use `encodeURIComponent(sourceId)`.
- Download paths use `sanitizeSegment()` — strips path separators and illegal
  chars, guards Windows reserved names (`CON`, `PRN`, …), caps length.
- 35 IPC handlers reviewed: all input originates from the trusted renderer; none
  reach a shell, `eval`, or an unvalidated filesystem path.

## Dependencies

`npm audit --omit=dev` → **0 vulnerabilities**. Runtime deps: `cheerio`, `yazl`.
Everything else (electron, vite, svelte, acorn) is dev/build-time.

## Privacy

- **No telemetry, analytics, or phone-home.** All data (bookmarks, settings,
  cache, cookies) is stored locally under the OS user-data dir.
- Scraping necessarily reveals the user's IP to the manga sites they browse
  (inherent to any downloader). The anti-bot clearance cookie is persisted in the
  shared session so the user solves a challenge once per site — **accepted by
  design**, and scoped to the sites they actually visit.

## Follow-ups (non-blocking, for Phase 5+)

- Sign the release builds (code-signing certs) and ship auto-update over HTTPS
  with signature verification (electron-updater) — part of Phase 5.
- Optional: a per-source "trust" indicator and a setting to disable code plugins
  entirely for locked-down installs.
