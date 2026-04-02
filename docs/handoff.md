# Handoff

## What this project is

A Windows Electron shell that hosts the existing local OpenClaw dashboard and now uses the real installed OpenClaw runtime contract on this machine instead of a guessed HTTP-only lifecycle.

The current path is:
1. app starts
2. run `openclaw gateway status`
3. probe `http://127.0.0.1:18789/health`
4. if not healthy, attempt `openclaw gateway start`
5. if healthy, request a fresh tokenized dashboard URL with `openclaw dashboard --no-open`
6. if the loaded dashboard still reports an auth/token problem, clear the dashboard origin state and retry once
7. if recovery still fails, load the local runtime control page with truthful recovery details instead of implying the runtime is simply off

## Source of truth files

- `src/main.ts` — app lifecycle, window load decisions, IPC handlers
- `src/gateway.ts` — CLI command execution, status parsing, health checks, and control actions
- `src/config.ts` — environment overrides and local install defaults
- `src/tray.ts` — tray icon resolution and tray actions
- `renderer/status.html` — current fallback runtime control page
- `docs/launch-readiness.md` — honest launch status and blockers
- `docs/windows-packaging.md` — packaging reality and gaps

## Verified runtime behavior

This shell was updated against a real local install, not just assumptions.

Verified on this machine:
- `openclaw gateway status` reports a registered Windows Scheduled Task service
- gateway bind is loopback and the dashboard is on `http://127.0.0.1:18789/`
- `/health` returns structured JSON and is the best live attach check
- `/status` currently returns dashboard HTML, so it is not used as structured status data
- `openclaw gateway health` returns readable health lines that can still be surfaced as diagnostics

## Current implementation notes

- The preferred implementation lane is TypeScript under `src/`.
- `src-electron/` is still legacy JS reference material only.
- Gateway state is no longer decided by a few output heuristics alone; it now combines:
  - CLI `gateway status`
  - HTTP `/health`
  - CLI `gateway health` when the runtime reports running
- Start/stop/restart are wired to the installed OpenClaw CLI commands and verified with follow-up polling.
- Command output is now captured and returned to the renderer.

## Known sharp edges

- The fallback page is diagnostics-first, not polished product UI.
- The app still assumes a per-user OpenClaw CLI install unless overridden by env vars.
- The app does not yet stream live service logs or tail the runtime log file.
- Packaged installer behavior has not been proven on a clean machine yet.
- Runtime auth and remote-connect flows are outside this shell's current scope.

## Best next move

If you only do one engineering step next, make packaged behavior real:
- build the unsigned installer
- install it on the target Windows machine
- verify tray lifecycle, CLI detection, and dashboard attach behavior
- record exactly what fails so the shell can move from dev-truthful to ship-truthful
