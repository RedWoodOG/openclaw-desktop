<p align="center">
  <img src="build/icon.png" alt="OpenClaw" width="96" />
</p>

<h1 align="center">OpenClaw Desktop</h1>

<p align="center">
  A native Windows desktop app for the <a href="https://openclaw.ai">OpenClaw</a> gateway.<br/>
  No browser tabs. No web UI. Just a clean, local desktop experience.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue?logo=windows" alt="Windows" />
  <img src="https://img.shields.io/badge/electron-37-47848F?logo=electron" alt="Electron 37" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
</p>

---

## What It Does

OpenClaw Desktop wraps the OpenClaw gateway dashboard in a native Electron window. It connects to your **locally running** OpenClaw gateway, automatically authenticates, and gives you the full Control UI without opening a browser.

- Automatically detects and connects to your local gateway
- Fetches a secure token via the CLI &mdash; no manual copy-paste
- Starts the gateway for you if it's not already running
- System tray integration &mdash; runs quietly in the background
- Single-instance lock &mdash; only one window at a time
- Recovery page with gateway controls if something goes wrong

## First-Time Setup

If you've never used OpenClaw before, you'll need to set it up once before the desktop app can connect. This takes about 2 minutes.

### Step 1: Install Node.js

Download and install **Node.js 18+** from [nodejs.org](https://nodejs.org). This is required to run the OpenClaw CLI and to build the desktop app.

### Step 2: Install the OpenClaw CLI

```bash
npm install -g openclaw
```

### Step 3: Run onboarding

```bash
openclaw onboard
```

This interactive wizard walks you through:
- Choosing an AI provider (OpenAI, Anthropic, OpenRouter, local models via Ollama, and many more)
- Entering your API key
- Setting up the gateway as a background service
- Optionally connecting messaging channels (Telegram, Discord, WhatsApp, etc.)

Once onboarding completes, your gateway is configured and ready.

### Step 4: Start the gateway

```bash
openclaw gateway start
```

The gateway runs in the background on `http://127.0.0.1:18789`. On Windows, it registers as a Scheduled Task that auto-starts on login, so you typically only need to do this once.

### Step 5: Launch the desktop app

Now you're ready to use OpenClaw Desktop. It will auto-detect the gateway, authenticate, and load the dashboard.

> **Already have OpenClaw set up?** Skip to Quick Start below.

## Quick Start

```bash
git clone https://github.com/RedWoodOG/openclaw-desktop.git
cd openclaw-desktop
npm install
npm run dev
```

The app will build, launch, detect your gateway, grab a token, and load the dashboard.

## Build a Standalone Installer

```bash
npm run dist
```

The packaged app lands in `release/`. You'll get a portable `OpenClaw Desktop.exe` that works without Node.js installed.

For a directory build (no installer, just the unpacked exe):

```bash
npm run pack
```

## Project Structure

```
openclaw-desktop/
  src/
    main.ts        # Electron main process, window lifecycle, dashboard loading
    gateway.ts     # CLI command execution, health checks, gateway control
    config.ts      # Environment-based configuration with sensible defaults
    preload.ts     # Secure IPC bridge for the renderer
    tray.ts        # System tray icon and context menu
  renderer/
    status.html    # Recovery/diagnostics page (fallback when dashboard fails)
  build/
    icon.ico       # Windows app icon (multi-resolution)
    icon.png       # Window/taskbar icon
    tray-icon.png  # System tray icon
```

## Configuration

All settings have sensible defaults. Override with environment variables if needed:

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | Gateway base URL |
| `OPENCLAW_CLI_PATH` | `%APPDATA%\npm\openclaw.cmd` | Path to the OpenClaw CLI |
| `OPENCLAW_WORKDIR` | `%USERPROFILE%\.openclaw` | OpenClaw working directory |

## How It Works

1. **Startup** &mdash; checks gateway health via HTTP (`/health`) and CLI (`openclaw gateway status`)
2. **Auto-start** &mdash; if the gateway isn't running, runs `openclaw gateway start` and waits
3. **Token fetch** &mdash; calls `openclaw dashboard --no-open` to get a secure tokenized URL
4. **Dashboard load** &mdash; loads the tokenized URL in the Electron window; the dashboard SPA handles authentication from the URL hash
5. **Fallback** &mdash; if anything fails, shows a recovery page with gateway status and control buttons

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Build + launch the app |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Launch without rebuilding (uses existing `dist/`) |
| `npm run pack` | Build + package as unpacked directory |
| `npm run dist` | Build + package as Windows installer |
| `npm run typecheck` | Type-check without emitting |

## Contributing

Pull requests welcome. If you're adding a feature:

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Make your changes
4. Run `npm run typecheck` to verify
5. Submit a PR

## License

[MIT](LICENSE)
