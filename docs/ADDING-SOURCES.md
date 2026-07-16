# One-Click Source Management (Source Studio)

Goal: **adding a manga source = clicking "Add source" and filling 3–4 fields. Removing = one
click.** No code, no PR, no rebuild. This is the flagship feature of the modernization.

## Why this is feasible (evidence from the legacy codebase)

- 77% of the 1,334 existing connectors are a template + 4 fields (`id`, `label`, `tags`, `url`).
  All site-specific logic lives in 45 shared templates (WordPressMadara, WordPressMangastream,
  FoolSlide, MangaReaderCMS, …) that expose overridable CSS selectors.
- The legacy app already hot-loads user plugins from `{userData}/hakuneko.plugins` at startup —
  the extension mechanism exists; it just requires writing JS today.

## Design

### 1. Declarative source definitions

A source is a JSON file, not a class:

```json
{
  "$schema": "https://hakuneko.dev/schemas/source-v1.json",
  "id": "mangakakalot",
  "label": "MangaKakalot",
  "tags": ["manga", "webtoon", "english"],
  "url": "https://www.mangakakalot.gg",
  "template": "manganel",
  "overrides": {
    "queryChapters": "div.chapter-list a"
  },
  "icon": "data:image/png;base64,…",
  "nsfw": false,
  "language": "en"
}
```

- `template` names one of the typed template engines (ported from the 45 legacy templates).
- `overrides` may tweak any selector/option the template exposes (typed & validated per template
  via JSON Schema generated from the template's config interface).
- Definitions live in the user data dir (`sources/*.json`) and in a bundled catalog.
  Add = write file. **Remove = delete file.** Both are trivially undoable (trash, not hard-delete).

### 2. "Add source" wizard (Source Studio)

Step-by-step UI, total time ≈ 30 seconds:

1. **Paste the website URL.** That's the only required input.
2. **Auto-detect the template.** The app fetches the site (through the anti-bot RequestBridge)
   and fingerprints it: Madara exposes `wp-content/themes/madara`/`manga-chapters-holder`,
   Mangastream/FoolSlide/MangaReaderCMS/Genkan/HeanCms/… all have similarly checkable markers
   (meta generator tags, known endpoints like `/wp-admin/admin-ajax.php` with
   `action=madara_load_more`, `/api/…` shapes). Show the matched template with a confidence
   badge; let the user override from a dropdown when detection fails.
3. **Prefill everything else**: label from `<title>`/og:site_name, icon from favicon
   (fetched and embedded as base64), language from `<html lang>`, tags suggested.
4. **Live test panel** (the critical UX piece): before saving, the wizard runs
   `getMangas → getChapters → getPages` against the real site and shows the first results
   (manga titles, a chapter list, a thumbnail of page 1). Green check = save with confidence.
   Failure = show which step broke and offer the selector-override editor (advanced accordion,
   with "pick element on page" helper in a preview webview — still no code).
5. **Save** → JSON written to `sources/`, source instantly appears in the source list (registry
   watches the folder — no restart).

### 3. Remove / manage

- Every source row has **Remove** (moves JSON to trash / disables bundled ones via a tombstone
  entry — bundled catalog files are never deleted, just masked).
- Enable/disable toggle, "Test" re-runs the live check, "Edit" reopens the wizard prefilled.
- **Import/Export**: a source pack is just a JSON array — shareable as a file or URL. "Add from
  URL" installs a community pack. (Signed/reviewed catalog can come later.)

### 4. Escape hatch for complex sites

Sites needing custom logic (API auth, image descrambling) use a **code plugin**: a `.ts`/`.mjs`
file implementing the `SourceProvider` interface, dropped in `sources/custom/` (same folder-watch
hot-load). The wizard detects "no template matched" and links to a documented plugin template.
This mirrors the ~300 legacy custom connectors.

### 5. Migration of the existing 1,334 sources

- Codemod (Phase 2 of the roadmap) statically parses each legacy connector's constructor
  (they only assign literals: `super.id = 'x'; this.url = '…'; this.queryX = '…'`) and emits the
  JSON definition automatically → instant bundled catalog of ~1,034 sources.
- Custom connectors are ported by hand, ordered by popularity; until ported they're absent from
  Reborn (tracked in a parity list).

## Security notes

- JSON sources are pure data validated against a schema — installing one can't execute code.
- Code plugins CAN execute code: the UI must label them clearly and require an explicit
  confirmation on install; never auto-install code plugins from URLs.
- Icon fetching and site probing go through the same rate-limited request bridge as scraping.
