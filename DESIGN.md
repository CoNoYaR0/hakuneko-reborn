# HakuNeko Reborn — Design System

Generated with the **ui-ux-pro-max** skill (`.claude/skills/ui-ux-pro-max/`) and adapted for a
desktop media-library / downloader: dense lists, long sessions, dark-first, keyboard-driven.

Regenerate/extend with, e.g.:
```bash
cd .claude/skills/ui-ux-pro-max
python3 scripts/search.py "dark manga library downloader" --design-system --project-name "HakuNeko Reborn" --format markdown
python3 scripts/search.py "large lists virtualization" --domain ux
```

## Style

**Dark Mode (OLED)** — deep near-black surfaces, high contrast, low white emission for long
reading/downloading sessions. Light mode is a supported secondary scheme (single token set,
not a duplicate frontend like legacy). Performance: excellent; targets WCAG AA (AAA where cheap).

## Palette

Warm accent (honors HakuNeko's cat/orange heritage) on neutral OLED greys. Tokens live in
[`src/renderer/src/theme.css`](src/renderer/src/theme.css) as CSS custom properties.

| Role | Dark | Light | Token |
|---|---|---|---|
| Background | `#0e0e12` | `#f6f6f8` | `--color-bg` |
| Surface | `#17171d` | `#ffffff` | `--color-surface` |
| Surface raised | `#1f1f27` | `#ffffff` | `--color-surface-raised` |
| Border | `#2c2c37` | `#dcdce4` | `--color-border` |
| Text | `#e9e9f0` | `#1b1b23` | `--color-text` |
| Text muted | `#9a9aa8` | `#5c5c68` | `--color-text-muted` |
| Accent (CTA) | `#f2683c` | `#e0563f` | `--color-accent` |
| On accent | `#ffffff` | `#ffffff` | `--color-accent-contrast` |
| Success | `#3fae6a` | `#2f9d5b` | `--color-success` |
| Danger | `#e5484d` | `#d64550` | `--color-danger` |
| Focus ring | `#f2683c` | `#e0563f` | `--color-ring` |

Accent is reserved for primary actions and active nav — never for large fills (keeps the OLED
darkness and lets "Add source" / "Download" pop). Status colors are for job/source state only.

## Typography

- **Family:** Inter for UI (heading + body); system-ui fallback so first paint never blocks on a
  web font. `ui-monospace` for URLs, selectors, and log/console panels.
- **Scale (px):** 24 h1 · 16 h2 · 14 body · 12 meta. Line-height 1.5.
- Bundle Inter locally (no runtime Google Fonts fetch — offline-first desktop app + CSP).

## Spacing & shape

4-based scale: `--space-1..5` = 4/8/16/24/40. Radii: `--radius-sm` 6px (controls),
`--radius-md` 10px (cards). Dense list rows ~36–40px tall.

## UX rules (from the skill's guidelines, scoped to this app)

- **Search everywhere it matters** (sources, library): debounced autocomplete, predictions as the
  user types; never require full type + Enter. Always render a helpful empty state
  ("No sources match 'X' — try …"), never a blank pane or bare "0 results".
- **Large lists must be virtualized** (sources ≈1k+, manga lists 50k+). Keep the main JS bundle
  small; monitor it. Legacy imported 1,334 modules up front — Reborn must not.
- **Every clickable element:** `cursor: pointer`, a visible hover transition (150–300ms), and a
  visible keyboard focus ring (`--color-ring`).
- **Respect `prefers-reduced-motion`** — gate all non-essential animation behind it.
- **Icons are SVG** (Heroicons/Lucide style), never emoji. Bundle locally.
- **Long-running actions** (source test, downloads) always show progress and are cancelable.

## Pre-delivery checklist (run per screen)

- [ ] Dark + light both legible; text contrast ≥ 4.5:1 (≥ 3:1 for large text)
- [ ] Keyboard reachable; focus states visible throughout
- [ ] `prefers-reduced-motion` respected
- [ ] Lists virtualized; no layout shift on load
- [ ] Empty, loading, and error states designed (not just the happy path)
- [ ] Responsive down to a narrow window (≥ 900px min, graceful below)
- [ ] SVG icons, no emoji; `cursor-pointer` on interactive elements

## UX review pass (2026-07-14) — every screen checked against the checklist

Reviewed with the ui-ux-pro-max `--domain ux` checklist. Result per screen:

| Screen | Contrast | Keyboard/focus | Loading/empty/error | Virtualized | Notes |
|---|---|---|---|---|---|
| App shell (rail) | ✓ | ✓ nav is `<button>`s, active state | — | — | `<nav>`/`<main>` landmarks; count badges |
| Sources | ✓ | ✓ | ✓ placeholder + per-column loading | ✓ manga list | icon buttons have `aria-label` |
| Source browser | ✓ | ✓ | ✓ loading `role="status"`, error line | ✓ | refresh/bookmark/download labelled |
| Library | ✓ | ✓ | ✓ empty + stale-source message | ✓ bookmarks | NEW badge = text, not color-only |
| Downloads | ✓ | ✓ | ✓ empty + per-job status | — (small) | progress bar + cancel/retry |
| Settings | ✓ | ✓ | ✓ inline messages | — | segmented controls, tabular rate value |
| Source Studio | ✓ | ✓ Esc + autofocus URL | ✓ live-test per-step ✓/✕ | — | override picker; recommended-save ring |
| Age gate / plugin warning | ✓ | ✓ Esc + focus safe action | — | — | scrim 55–65%; danger color + label |

Fixes applied in this pass:
- `role="status"` on all "loading…" indicators so screen readers announce them.
- `aria-label` on every icon-only control (refresh ⟳, bookmark ☆/★, download ⭳, remove ✕, edit ✎, duplicate ⧉).
- Modal focus management: age-gate and plugin-warning dialogs focus their **safe** (cancel) action on open; every dialog closes on **Esc**.
- Info conveyed by more than color: NEW chapters use a text badge; 18+ uses a text badge; test steps use ✓/✕ glyphs.
- Manual theme override (`data-theme`) added so Settings → Light/Dark wins over the OS preference; both palettes meet ≥4.5:1 body contrast.

Known desktop deviations from the (mobile-oriented) checklist: touch targets are
mouse-sized (icon buttons ~20px with padding, not 44px) — acceptable for a
desktop pointer app; hover-reveal row actions are paired with always-available
keyboard focus.
