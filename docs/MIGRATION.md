# Migrating from legacy HakuNeko to HakuNeko Reborn

Reborn is a fresh app with its own storage. Nothing is read or changed
automatically, so your old install is left untouched. The one thing worth
bringing over is your **bookmarks / favourites**; downloaded chapters are just
files you already have.

## Bring over your bookmarks

### The easy way (recommended)

1. Open your **old** HakuNeko.
2. Bookmarks → **Export** → save the `.json` file somewhere.
3. Open **HakuNeko Reborn** → **Library** → **Import favourites** → pick that file.

Reborn reads the legacy export shape directly:

```json
[
  { "title": { "connector": "MangaDex", "manga": "Berserk" },
    "key":   { "connector": "mangadex", "manga": "801513ba-…" } }
]
```

The importer matches on the connector **key** (`key.connector` → source id,
`key.manga` → manga id), so a bookmark lines up with the same source in Reborn when
the ids match. Entries whose source isn't present in Reborn are imported anyway (they
show once you add that source) and counted as skipped if malformed. Import is
idempotent — re-importing won't create duplicates.

### If you can't open the old app

Legacy HakuNeko stored its data under a per-OS config directory:

| OS | Legacy data directory |
|---|---|
| Linux | `~/.config/hakuneko/` |
| Windows | `%APPDATA%\hakuneko\` |
| macOS | `~/Library/Application Support/hakuneko/` |

Find the bookmarks export/JSON there and import it as above. (Portable installs
keep it next to the executable.)

## Where HakuNeko Reborn keeps *its* data

Shown in **Settings → About / paths**, and by default:

| OS | Reborn user data |
|---|---|
| Linux | `~/.config/hakuneko-reborn/` |
| Windows | `%APPDATA%\hakuneko-reborn\` |
| macOS | `~/Library/Application Support/hakuneko-reborn/` |

- `sources/` — your added sources (one JSON per source) + `custom/` code plugins
- `bookmarks.json` — your favourites (Reborn shape)
- `cache/` — manga-list cache (safe to delete; rebuilt on demand)
- Downloads default to `~/Downloads/hakuneko-reborn/` (configurable)

Reborn uses its **own** `hakuneko-reborn` directory, deliberately separate from
legacy HakuNeko's `hakuneko` directory. Your old install is never read, written
or overwritten — the two can sit side by side, and uninstalling one won't touch
the other's data.

## What's different on purpose

- **Sources are one-click.** Instead of shipping 1,334 connectors, Reborn has a
  verified catalog plus **Source Studio** (paste a URL → it detects and tests the
  site → save). Most old sites work as-is; the rest via the adaptive extractor.
- **Adult sources are hidden by default** behind an 18+ age gate.
- **No anime/video downloads** — Reborn is manga-only. See [PARITY.md](PARITY.md).
- **Auto-updates** — Reborn updates itself (Settings → Updates).

See [PARITY.md](PARITY.md) for the full feature-by-feature comparison.
