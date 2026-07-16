# HakuNeko Reborn — User Guide

A friendly walkthrough for using HakuNeko Reborn. No coding required for anything here.

> Screenshots: this build runs on Linux/Windows/macOS. Capture screenshots on
> your own machine with `npm run dev` — the agent environment that
> produced this app can't grab the Electron window, so image files aren't
> bundled. Placeholders below mark where each screenshot goes.

## The four screens

HakuNeko has a slim icon rail on the left with four places:

| Icon | Screen | What it's for |
|---|---|---|
| ⌘ | **Sources** | Browse and manage manga sites; add/remove/edit sources |
| ★ | **Library** | Your bookmarked manga across all sources, with new-chapter marks |
| ⭳ | **Downloads** | Progress of chapters you're downloading |
| ⚙ | **Settings** | Format, theme, rate limit, adult toggle, import/export |

_[screenshot: app-shell.png — the four-icon rail and the Sources screen]_

## Browsing a source

1. Click **Sources** in the rail.
2. Pick a site from the searchable list (type to filter 300+ sources).
3. The three columns fill in left-to-right: **Manga → Chapters → Pages**.
   - Click a manga to load its chapters; click a chapter to load its pages.
   - The manga list is virtualized, so even 50,000-title sites scroll smoothly.
   - Hit the **⟳** button above the manga list to refresh from the site (lists
     are otherwise cached for a day so re-opening is instant).

_[screenshot: source-browser.png — three-column manga/chapter/page browser]_

## Bookmarking & the Library

- In a source's manga list, click the **☆** next to a title to bookmark it
  (turns into a filled **★**).
- The **Library** screen collects every bookmark from every source in one place.
- Open a bookmark to see its chapters. Chapters you haven't seen since your last
  visit are tagged **NEW** in green.
- Remove a bookmark with the **✕** on its row.

_[screenshot: library.png — bookmarks with NEW badges]_

## Downloading

- Hover a chapter (in Sources or Library) and click **⭳** to queue it.
- Chapters download one at a time; pages within a chapter download in parallel.
- Watch progress on the **Downloads** screen — cancel a running job, or retry a
  failed one. "Clear finished" tidies the list.
- Output goes to `~/Downloads/hakuneko-reborn/<Manga>/<Chapter>.cbz` by default
  (change to plain image folders in Settings).

_[screenshot: downloads.png — progress bars with cancel/retry]_

## Adding a new source (Source Studio) — the one-click flow

This is the headline feature: add a manga site **without writing any code**.

1. On the **Sources** screen, click **+ Add**.
2. **Paste the site's URL** and click **Detect**.
3. HakuNeko fetches the site and figures out:
   - which engine ("template") it uses, with a confidence score,
   - the site's name, language, and icon (all pre-filled and editable).
4. Click **Run test**. HakuNeko actually pulls a manga → its chapters → its
   pages and shows a green ✓ or red ✕ for each step, with a sample and a
   thumbnail. **If the test is green, the source works.**
5. Click **Save source**. It appears in your list immediately.

_[screenshot: source-studio.png — detected template + green live-test]_

### If the test doesn't fully pass

- Try a different **Template** from the dropdown (matches are marked ✓).
- Open **Advanced → selector overrides** and use **⌖ Pick element**: HakuNeko
  opens the real site; click the manga/chapter/page element you mean, and it
  captures the CSS selector for you. Pick which field it fills, then re-test.

## Managing sources

Hover any source in the list for three actions:

- **✎ Edit** — reopen the wizard pre-filled to tweak and re-test.
- **⧉ Duplicate** — make a copy (handy for a site with a second domain).
- **✕ Remove** — delete it. Built-in sources are just hidden (reversible);
  your own are deleted.

## Sharing sources (packs)

In **Settings → Source packs**:

- **Export pack** downloads all your sources as one JSON file.
- **Import pack** installs sources from a JSON file someone shared with you.

## Adult content (18+)

- Sources with adult content are **hidden by default** and marked **18+**.
- To see them, toggle **Show adult sources** (in the Sources sidebar or
  Settings). You'll be asked to confirm you're 18 or older first.
- Turn it back off any time — no confirmation needed.

_[screenshot: age-gate.png — the 18+ confirmation dialog]_

## Settings

| Setting | What it does |
|---|---|
| **Download format** | `.cbz` archive (default) or a folder of images |
| **Requests per site** | 1–16; lower is gentler on sites, higher is faster |
| **Theme** | System / Light / Dark |
| **Show adult sources** | The 18+ gate described above |
| **Bookmarks import/export** | Bring bookmarks over from classic HakuNeko, or back yours up |
| **Source packs** | Share/install source collections |
| **Code plugins** | Advanced escape hatch — see below |

## Advanced: code plugins

A few sites are too unusual for the template system (custom APIs, scrambled
images). For those, a **code plugin** — a small `.mjs` program — can implement
the source directly.

⚠️ **A code plugin runs real code on your computer.** HakuNeko shows a clear
warning and only installs a file you personally choose. It never installs
plugins from the internet automatically. Only install plugins you wrote or got
from someone you trust. See [ADDING-SOURCES.md](ADDING-SOURCES.md) for the
plugin contract.

## Keyboard & accessibility

- Every screen is keyboard-navigable; focus rings are always visible.
- **Esc** closes any dialog.
- The app respects your OS "reduce motion" setting.
- Light and dark themes are both tested for contrast.
