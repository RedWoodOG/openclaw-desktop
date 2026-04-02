# Launch Readiness

## Current truth

`openclaw-desktop` is a Windows Electron shell for a **locally installed** OpenClaw runtime.

What is actually working today:
- Electron main/preload flow in TypeScript
- single-instance behavior
- tray menu with open / refresh / quit
- dashboard load when the local gateway is healthy
- local fallback runtime control page when the gateway is offline or unreachable
- runtime fact gathering from the real installed CLI surface:
  - `openclaw gateway status`
  - `openclaw gateway health`
  - `openclaw gateway start`
  - `openclaw gateway stop`
  - `openclaw gateway restart`
- command output capture returned to the renderer
- state classification for at least these cases:
  - healthy
  - stopped
  - unreachable
  - cli-missing
  - status-unknown
- Windows packaging config via `electron-builder`

What is **not** done:
- no bundled OpenClaw runtime
- no first-run install/repair flow
- no live log tail or streaming progress UI
- no signed production packaging pipeline
- no clean-machine packaging validation recorded yet
- current `npm run dist` packaging is blocked on this machine by `electron-builder` failing to extract `winCodeSign` because Windows symlink privileges are missing

## Readiness call

This project is **meaningfully stronger than the initial MVP** and is **buildable for internal testing**.

It is still **not launch-ready for external distribution**.

## Why it is stronger now

The shell is no longer pretending `/status` is a trustworthy structured endpoint.
It was re-wired around the runtime behavior actually observed on this Windows machine:
- service-managed gateway lifecycle
- loopback dashboard attach at `127.0.0.1:18789`
- JSON health from `/health`
- CLI-driven control and diagnostics

That makes the runtime layer more honest and more operable.

## Blocking gaps before a real launch

### 1) Packaged app verification is still missing
- Build the unsigned installer and package successfully.
- Current observed blocker: `electron-builder` fails while extracting `winCodeSign` in the cache because this Windows session lacks the privilege needed to create symlinks.
- After that is cleared, verify tray behavior, close-to-tray, relaunch, start/stop/restart, and dashboard attach in the packaged app.
- Confirm the packaged app still resolves the installed CLI path correctly.

### 2) The fallback page still looks like an internal tool
- Convert diagnostics-first rendering into a product-quality control surface.
- Add clearer error copy and recovery guidance for common failures.
- Show runtime log access without dumping raw JSON by default.

### 3) Missing install and repair story
- Decide what happens when `openclaw.cmd` is not installed.
- Decide whether the app should help install/fix the runtime or stay strictly attach-to-local.
- Document supported versions or add compatibility checks.

### 4) Operational support surface is still shallow
- Tail the runtime log file reported by `gateway status`.
- Record known failure signatures and recovery steps.
- Add smoke coverage around status parsing and lifecycle commands.

## Recommended next actions

1. Run packaged-build smoke tests on Windows and record exact results.
2. Add log-file viewing or tailing from the fallback page.
3. Harden compatibility checks around CLI discovery and service registration.
4. Only after packaging is verified, decide whether this remains an attach-to-local utility or becomes a fuller desktop product.

## Minimum internal-test gate

Treat the app as ready for a wider internal test only when all of these are true:
- `npm run build` succeeds cleanly
- `npm run dist` produces a Windows installer
- packaged app opens to dashboard when gateway is already healthy
- packaged app shows fallback control page when gateway is down
- start/stop/restart give truthful success or failure results on the test machine
- tray open/refresh/quit behavior works twice in a row
