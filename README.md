# HakuNeko Reborn

A modern rebuild of **[HakuNeko](https://github.com/manga-download/hakuneko)** — the
manga downloader — brought back to life on a current stack, with **one-click sources**:
paste a site URL, the app figures out how to read it, tests it live, and saves it. No
coding, no waiting for someone to write a connector.

> **Status: `1.0.0-alpha.0` — early alpha.** It works, it's tested (87 unit tests, live
> end-to-end runs), and it's been used for real downloads. But it's alpha: expect rough
> edges, expect breaking changes, don't treat it as your only copy of anything.

---

## 🙏 Standing on HakuNeko's shoulders

**This project would not exist without [HakuNeko](https://github.com/manga-download/hakuneko)
and the HakuNeko Development Team.** That's not a courtesy line — it's the honest
accounting. HakuNeko did **half this work or more**, and the hardest half:

- Years of accumulated, hard-won knowledge about **how ~1,300 manga sites actually
  behave** — encoded in its connectors and templates. That's the real treasure here.
- The **anti-bot approach** (rendering pages in a real browser window to get past
  Cloudflare / DDoS-Guard). HakuNeko figured out that this needs a real Chromium; every
  workaround in Reborn descends from `Request.mjs#fetchUI`.
- The **scraping recipes** — Madara, Mangastream, FoolSlide, MangaReaderCMS and friends.
  Reborn's templates are ports of theirs, including subtle load-bearing details (like the
  `<img>`→`<source>` markup rewrite) that took real work to discover and are not
  guessable.
- The **architecture** — connectors, templates, download manager, per-OS paths, the
  ad/tracker blocklist, portable mode. Reborn's shape is HakuNeko's shape.

HakuNeko went unmaintained for years. Reborn is an attempt to carry it forward, not to
replace or compete with it. All the original insight is theirs; the bugs are ours.

**Go star the original: <https://github.com/manga-download/hakuneko>**

HakuNeko is released under the [Unlicense](https://unlicense.org/) (public domain), so
this credit is given freely rather than out of obligation. It's deserved.

---

## What's different

| | HakuNeko (legacy) | HakuNeko Reborn |
|---|---|---|
| Adding a source | Write a connector in JS, ship a release | **Paste a URL** → auto-detect → live test → save |
| Unknown/changed site | Connector breaks, wait for a fix | **Adaptive extractor** reads it structurally; **self-heals** when a template returns nothing |
| Stack | Electron 8 (2020) + Polymer | Electron 43 + Svelte 5 + TypeScript 5 + Vite 7 |
| Catalog | 1,334 connectors, many long dead | **210 functionally verified** sources (each one tested for actually serving manga) |
| Adult content | Mixed into the list | **Hidden by default** behind an 18+ age gate |
| Formats | cbz, folder, pdf, epub | Same — cbz, folder, **pdf**, **epub** |
| Updates | Manual | **Auto-update** built in |
| Anime/video | Yes | **No** — manga only, on purpose |

## Features

- **One-click sources** — Source Studio detects the site engine, live-tests it end to
  end, and only lets you save it if it actually works.
- **Adaptive extraction** — a structure-based reader with no fixed selectors, so sites
  that drift (or were never templated) still work. Falls back automatically.
- **Anti-bot that works *with* you** — when Cloudflare shows a challenge, the window pops
  up, you click once, and the whole session is unlocked from then on.
- **MangaDex built in** — via its official API.
- **Ad/tracker/malware blocking** while scraping.
- **Fast** — virtualized lists (50k+ rows), lazy source loading, caching.
- **Linux-first**, Windows supported. AppImage / deb / rpm / NSIS / portable.

## Install

Grab an installer from [Releases](../../releases). Linux: AppImage, `.deb`, `.rpm`.
Windows: installer or portable `.exe`.

> Alpha builds are **unsigned** — Windows SmartScreen will warn you. Linux is unaffected.

## Build from source

```bash
npm install
npm run dev          # run it
npm run typecheck && npm test && npm run build
npm run dist:linux   # AppImage + deb + rpm
```

Requires Node 22+.

**If `npm run dev` fails with `Error: Electron uninstall`**, the Electron binary
didn't download during `npm install` (npm ran with install scripts disabled, or the
download was blocked — common in sandboxes, containers, and immutable distros like
Bazzite/Silverblue). Fetch it manually:

```bash
node node_modules/electron/install.js
```

If that errors, `npm config get ignore-scripts` is likely `true`; unset it, then
`rm -rf node_modules && npm install` and run the line above again. To just *use* the
app rather than develop it, grab a build from [Releases](../../releases) instead — on
immutable distros the AppImage (`--appimage-extract-and-run` if FUSE is missing) is
easiest.

## Repo layout

```
src/        The app — main / preload / renderer / shared
  main/       Electron main: engine, scraping, downloads, anti-bot bridge
  renderer/   Svelte 5 UI
resources/  Bundled source catalog + JSON schemas
scripts/    One-off tooling (the legacy connector codemod, health checks)
test/       Vitest suites
docs/       Architecture, roadmap, parity, migration, anti-bot notes
```

### Where's the legacy code?

Earlier revisions of this repo carried the whole legacy HakuNeko tree as porting
reference. It's served its purpose — the knowledge is now in `src/` and `docs/` — so it's
gone, and this repo contains only HakuNeko Reborn. The original lives where it always did:

```bash
git remote add upstream https://github.com/manga-download/hakuneko.git && git fetch upstream
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) documents how legacy worked, and is still the
best map if you go digging.

## Docs

| Doc | What |
|---|---|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | How to use it |
| [docs/MIGRATION.md](docs/MIGRATION.md) | Coming from legacy HakuNeko (bring your bookmarks) |
| [docs/PARITY.md](docs/PARITY.md) | Feature-by-feature vs legacy; what we kept/dropped |
| [docs/ADDING-SOURCES.md](docs/ADDING-SOURCES.md) | How one-click sources work |
| [docs/ANTI-BOT.md](docs/ANTI-BOT.md) | The Cloudflare/DDoS-Guard approach |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How legacy HakuNeko works |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What's done, what's next |
| [docs/RELEASING.md](docs/RELEASING.md) | Cutting a release |

## Legal & fair use

HakuNeko Reborn is a **downloader** — it ships no manga and hosts nothing. It reads
publicly reachable websites, the same ones your browser can. Support the official
releases and the scanlation groups where you can. Adult sources are gated behind an
explicit 18+ confirmation and hidden by default.

## License

[Unlicense](https://unlicense.org/) — public domain, the same as upstream HakuNeko.
