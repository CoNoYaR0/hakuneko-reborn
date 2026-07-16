# Releasing HakuNeko Reborn

HakuNeko Reborn is packaged with **electron-builder** and updates itself with
**electron-updater**. CI is GitHub Actions.

## What ships

| Platform | Artifacts | Auto-update |
|---|---|---|
| Linux | `.AppImage`, `.deb`, `.rpm` | AppImage (via `latest-linux.yml`) |
| Windows | NSIS installer `.exe`, portable `.exe` | NSIS (via `latest.yml`) |
| macOS (optional) | `.dmg` | needs Apple signing/notarization |

Each build also emits a `latest*.yml` manifest with a SHA-512 and a block map (for
delta downloads). electron-updater reads these from the GitHub Release.

## Local builds (for testing)

```bash
# (repo root)
npm run build              # compile main/preload/renderer
npx electron-builder --linux AppImage     # one target, fast
npm run dist:linux         # AppImage + deb + rpm
npm run dist:win           # NSIS + portable (on Windows / with wine)
```

Output lands in `dist/`. Verified locally: a ~128 MB `hakuneko-reborn-<ver>-linux-x86_64.AppImage`
plus a valid `latest-linux.yml`.

## Cutting a release

1. Bump the version in `package.json` (e.g. `1.0.0-alpha.1`).
2. Commit, then tag and push:
   ```bash
   git tag v1.0.0-alpha.1
   git push origin v1.0.0-alpha.1
   ```
3. The **Release** workflow (`.github/workflows/release.yml`) builds on `ubuntu-latest`
   and `windows-latest` and publishes every installer + `latest*.yml` to the GitHub
   Release for that tag (using the built-in `GITHUB_TOKEN`).
4. Installed apps that have "Automatic updates" on (Settings → Updates) pick it up on next
   launch: the user gets an in-app "Update X available" → Download → "Restart & install".

The publish target is set in `electron-builder.yml` under `publish:` — GitHub
`CoNoYaR0/hakuneko-reborn`. Keep it pointed there: electron-updater reads
`latest*.yml` from that repo's releases, so changing it breaks auto-update for
everyone already installed. It must never point at upstream
`manga-download/hakuneko` — that's a different project.

## Auto-update behaviour

- Only active in a **packaged** build (no-op in `npm run dev`).
- On startup (4s delay) it checks the feed **if** Settings → Updates → Automatic updates is
  on. The user can also check/download/install manually from Settings.
- `autoDownload` is **off** — the user chooses to download, so there's never surprise
  background traffic. `autoInstallOnAppQuit` is on, so a downloaded update applies on quit.

## Code signing (before a public stable)

The release workflow is **already wired** for signing — it passes the signing
secrets to electron-builder as env vars, and electron-builder auto-signs when
they're present. So signing is just "add the secrets"; nothing else changes.

Add these in the repo's **Settings → Secrets and variables → Actions**:

- **Windows**: `CSC_LINK` (the `.pfx`/`.p12` cert, base64-encoded) and
  `CSC_KEY_PASSWORD`. Without them the NSIS installer is unsigned and SmartScreen
  warns users.
- **macOS**: `CSC_LINK` / `CSC_KEY_PASSWORD` (Developer ID `.p12`) **plus**
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for notarization.
- **Linux**: AppImage/deb/rpm don't require signing (deb/rpm can optionally be
  GPG-signed).

Leave the secrets unset and the build stays unsigned — fine for Linux and for
testing. Add them before a wide Windows/macOS rollout. Auto-update signature
verification keeps working either way (it checks the SHA-512 in `latest*.yml`).

## CI

`.github/workflows/ci.yml` runs typecheck + tests + build on `ubuntu-latest` and
`windows-latest` for every push/PR. Keep it green before tagging.
