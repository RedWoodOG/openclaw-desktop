# Windows Packaging Plan

## Current packaging layer

Packaging is driven by `electron-builder` in `package.json`.

Configured targets:
- `nsis` for a standard Windows installer

Configured behavior:
- builder output goes to `release/`
- packaged app includes `dist/**/*`, `renderer/**/*`, and `package.json`
- executable runs at standard user privilege

## What is real right now

- Build metadata exists and is Windows-oriented.
- The packaged shell should include the TypeScript-built Electron main/preload output plus the fallback runtime page.
- The shell is wired for an **installed local OpenClaw CLI**, not an embedded runtime.
- Current runtime assumptions were validated on this machine:
  - user-scoped CLI at `%APPDATA%\npm\openclaw.cmd`
  - service-managed gateway lifecycle
  - dashboard at `http://127.0.0.1:18789/`
  - `/health` as the structured attach check

## What is still missing before production distribution

1. **Code signing**
   - Windows SmartScreen reputation will be rough without signing.
   - Need certificate strategy and CI secret handling.

2. **Real icons and installer assets**
   - Tray fallback assets exist, but packaging-grade `.ico` resources still need to be finalized.
   - Need consistent installer, taskbar, and tray branding.

3. **Packaged-build proof**
   - Need one real installer run and one uninstall/reinstall pass recorded.
   - Current observed blocker: `npm run dist` fails on this machine before artifact creation because `electron-builder` cannot extract `winCodeSign` without Windows symlink privileges.
   - After that is cleared, need proof that packaged app still discovers the CLI and can control the service.

4. **Runtime absence/repair handling**
   - If OpenClaw CLI is missing, the app currently reports that honestly but does not fix it.
   - Need a support path or installer-time strategy.

5. **Update strategy**
   - No auto-update design is wired yet.
   - Need provider choice, signing implications, and rollback policy.

## Recommendation

Use packaging now for internal dogfooding only.

Before claiming broader release readiness, verify:
- unsigned installer builds successfully
- packaged app launches and keeps tray behavior
- packaged app attaches to a healthy gateway
- packaged app reports truthful stop/start/restart outcomes
- packaged app handles missing CLI and stopped service states cleanly
