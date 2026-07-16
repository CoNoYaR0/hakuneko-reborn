# Anti-Bot Strategy (Cloudflare, DDoS-Guard, WAF)

How HakuNeko Reborn gets past the "Just a moment…" / "Verify you are human" walls, and
an honest evaluation of tools like [Scrapling](https://github.com/D4Vinci/Scrapling).

## Guiding principle: work WITH the challenge, not around it

We do **not** try to bypass or stealth past Cloudflare. That's an arms race we'd lose, and
the challenge will appear anyway. Instead we take advantage of the one thing a bot doesn't
have and we do: **a human sitting in front of the app who can click the button.**

The whole design follows from that:

1. The challenge appears — expected, fine.
2. The user solves it **once** in a real, visible window.
3. The clearance cookie lands in the **shared, persistent session** — so it carries to every
   later request to that host, **and survives app restarts** (Electron persists cookies to
   disk). One solve lasts the cookie's whole lifetime (typically 30 min – hours).
4. If a plain request is still walled right after solving, we **read the page straight from a
   browser window in that same cleared session** (the most reliable way to use what the human
   just unlocked).

Solving is the feature, not a failure.

## The current approach: solve-once-per-session, in a real window

Most scraping uses the fast path (`session.fetch`, Chromium's network stack — shares
cookies). When a response looks like an anti-bot challenge (`src/main/challenge.ts`:
HTTP 403/429/503, or body markers like "Just a moment"), the engine:

1. Calls `RequestBridge.ensureCleared(host)` (deduped per host — parallel page fetches
   share one window).
2. Opens the site's origin in a **real browser window** (`#clearWindow`).
3. **Automatic ("managed") challenges** pass on their own within a few seconds — the
   window stays hidden (6s grace period), the user sees nothing.
4. **Interactive challenges** (Turnstile "Verify you are human" checkbox) — after the
   grace period the window is **shown** so the user clicks once.
5. Once the page settles to real content, the window closes. The `cf_clearance` cookie is
   now in the shared session, so the retried request — and every later request to that
   host this session — succeeds.

Key correctness notes (learned the hard way):

- **Never key challenge detection off the `/cdn-cgi/challenge-platform/` script** —
  Cloudflare injects it on *every* page of a protected site, even cleared ones. Detect via
  the interstitial **title**, the **challenge containers** (`#challenge-form`,
  `#challenge-running`, `#challenge-stage`), and the **captcha iframe**.
- **The clearance window must keep `webSecurity: true`** (a normal browser). The scraping
  windows disable it to read cross-origin content, but doing so on the clearance window
  breaks the cross-origin Turnstile iframe and causes `bad IPC message` renderer crashes
  (the widget renders as a gray box you can't click).
- The window's UA must match `session.fetch`'s UA (both use the Electron-stripped UA), or
  Cloudflare won't honor the clearance cookie.

This mirrors what the original HakuNeko does, and it's the **reliable** baseline: a human
can always solve a challenge a bot can't.

## Evaluation: Scrapling (and why we don't embed it)

[Scrapling](https://github.com/D4Vinci/Scrapling) is an excellent **Python 3.10+** scraping
framework. For anti-bot it offers TLS-fingerprint impersonation, a stealth Playwright/Chromium
`StealthyFetcher`, and a `solve_cloudflare=True` mode that automates managed-challenge passing.

**Why it's a poor fit to embed in HakuNeko:**

| Concern | Detail |
|---|---|
| Language | Python vs HakuNeko's Electron/TypeScript. Would require bundling a Python runtime + Scrapling + its browser into the app. |
| Redundant engine | HakuNeko already ships a full Chromium (Electron). Scrapling brings its own Playwright Chromium/Firefox → two browser engines, +300–500 MB. |
| Packaging | Embedding Python + a Playwright browser into AppImage/deb/rpm **and** a Windows installer, cross-platform, is fragile and heavy. |
| Overlap | `solve_cloudflare` mainly automates *managed* challenges — which our window already passes invisibly. It does **not** reliably auto-solve *interactive* Turnstile (a human click) — the exact case where we need the window anyway. |

**What we borrow from it instead (native, no Python):**

- Strip the `Electron` token from the User-Agent (done, `headers.ts`).
- Pass managed challenges invisibly with a grace period before showing the window (done).
- Share the anti-bot cookie across the whole session so you solve **once per site** (done).

## If stronger automatic bypass is wanted later (optional, not embedded)

The realistic route to higher *automatic* bypass — without bloating the app — is an
**optional external helper** the user runs separately, that HakuNeko can be pointed at:

- **FlareSolverr** (standalone/Docker Cloudflare solver) — HakuNeko routes challenged
  requests through it when configured. Opt-in, zero cost when unused.
- A **Camoufox/Scrapling side-service** exposing a local HTTP endpoint, same idea.

These stay *optional infrastructure* for power users, not a mandatory dependency baked into
every install. For everyone else, the solve-once window is simpler and just works.

## TL;DR

- Fixed now: the window pops up for real challenges, renders the checkbox correctly, and
  passes managed challenges invisibly.
- Scrapling is great but wrong to embed (Python + second browser + packaging pain) — we took
  its useful ideas natively.
- Want max auto-bypass later? Add optional FlareSolverr/Camoufox routing, not an embedded lib.
