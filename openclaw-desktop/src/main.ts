import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import { desktopConfig } from './config';
import {
  checkGatewayHealth,
  getDashboardLaunchUrl,
  restartGatewayIntegrationPoint,
  startGatewayIntegrationPoint,
  stopGatewayIntegrationPoint,
  type GatewayState,
} from './gateway';
import { createTray } from './tray';

type DashboardSessionSeed = {
  dashboardUrl: string;
  gatewayHttpUrl: string;
  gatewayWsUrl: string;
  token?: string;
};

let mainWindow: BrowserWindow | null = null;
let latestGatewayState: GatewayState | null = null;
let isQuitting = false;

log.initialize();
app.disableHardwareAcceleration();
app.setAppUserModelId(desktopConfig.appUserModelId);

const preloadPath = path.join(__dirname, 'preload.js');
const statusPagePath = path.join(__dirname, '..', 'renderer', 'status.html');
const dashboardAuthIssuePattern =
  /unauthorized|gateway token missing|invalid token|token mismatch|forbidden|not authorized/i;

function createMainWindow(): BrowserWindow {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  const window = new BrowserWindow({
    width: desktopConfig.defaultWindow.width,
    height: desktopConfig.defaultWindow.height,
    minWidth: desktopConfig.defaultWindow.minWidth,
    minHeight: desktopConfig.defaultWindow.minHeight,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    title: desktopConfig.appName,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // The gateway sends X-Frame-Options: DENY and CSP frame-ancestors 'none',
  // which prevent the page from rendering inside Electron's BrowserWindow.
  // Strip these headers so the dashboard can load in the desktop app.
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];

    // Relax CSP so the dashboard can run inside Electron.
    // Remove frame-ancestors (blocks embedding) and loosen script-src
    // (blocks inline event handlers like the Connect button's onclick).
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') {
        headers[key] = headers[key]!.map((policy) =>
          policy
            .replace(/frame-ancestors\s+[^;]+;?\s*/gi, '')
            .replace(/script-src\s+[^;]+/gi, "script-src 'self' 'unsafe-inline' 'unsafe-eval'"),
        );
      }
    }

    callback({ responseHeaders: headers });
  });

  window.on('ready-to-show', () => window.show());
  window.webContents.on('console-message', (_event, level, message, _line, sourceId) => {
    if (level >= 2) {
      log.warn('Renderer', { level, message: message.slice(0, 500), sourceId });
    }
  });
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  return window;
}

function withGatewayDetail(state: GatewayState, detail: string, kind = state.kind): GatewayState {
  return {
    ...state,
    kind,
    detail,
  };
}

function buildDashboardSessionSeed(dashboardUrl: string): DashboardSessionSeed {
  const url = new URL(dashboardUrl);
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const params = new URLSearchParams(hash);
  const token = params.get('token') ?? undefined;

  if (desktopConfig.gateway.backend === 'rust') {
    // Rust runtime splits HTTP (control plane) and WebSocket across different ports.
    const httpControlUrl = `http://127.0.0.1:${desktopConfig.gateway.httpControlPort}`;
    const wsUrl = desktopConfig.gateway.baseUrl.replace(/^http/, 'ws');
    const rustToken = token ?? desktopConfig.gateway.rustToken;

    return {
      dashboardUrl,
      gatewayHttpUrl: httpControlUrl,
      gatewayWsUrl: wsUrl,
      token: rustToken,
    };
  }

  const gatewayHttpUrl = `${url.protocol}//${url.host}`;
  const gatewayWsUrl = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;

  return {
    dashboardUrl,
    gatewayHttpUrl,
    gatewayWsUrl,
    token,
  };
}

async function seedDashboardSession(window: BrowserWindow, seed: DashboardSessionSeed): Promise<void> {
  try {
    await window.webContents.executeJavaScript(
      `(() => {
        const seed = ${JSON.stringify(seed)};
        const candidates = [
          'openclaw.gateway.url',
          'gatewayUrl',
          'openclaw.control.gatewayUrl',
          'openclaw.control.url',
          'openclaw.gateway.wsUrl',
          'gatewayWsUrl',
          'openclaw.control.gatewayWsUrl'
        ];
        const tokenCandidates = [
          'openclaw.gateway.token',
          'gatewayToken',
          'openclaw.control.gatewayToken',
          'token'
        ];
        const payloadCandidates = [
          'openclaw.connection',
          'openclaw.control.connection',
          'connectionDetails'
        ];
        for (const key of candidates) {
          sessionStorage.setItem(key, key.toLowerCase().includes('ws') ? seed.gatewayWsUrl : seed.gatewayHttpUrl);
          localStorage.setItem(key, key.toLowerCase().includes('ws') ? seed.gatewayWsUrl : seed.gatewayHttpUrl);
        }
        if (seed.token) {
          for (const key of tokenCandidates) {
            sessionStorage.setItem(key, seed.token);
            localStorage.setItem(key, seed.token);
          }
        }
        const payload = JSON.stringify({
          url: seed.gatewayWsUrl,
          gatewayUrl: seed.gatewayHttpUrl,
          wsUrl: seed.gatewayWsUrl,
          token: seed.token ?? null,
          auth: seed.token ? { token: seed.token } : null,
        });
        for (const key of payloadCandidates) {
          sessionStorage.setItem(key, payload);
          localStorage.setItem(key, payload);
        }
        return true;
      })()`,
      true,
    );
  } catch (error) {
    log.warn('Failed to seed dashboard session state', error);
  }
}

async function detectDashboardAuthIssue(window: BrowserWindow): Promise<string | null> {
  try {
    const sample = await window.webContents.executeJavaScript(`(() => {
      const title = document.title || '';
      const text = (document.body?.innerText || '').slice(0, 4000);
      return [title, text].filter(Boolean).join('\n');
    })()`, true);

    if (typeof sample === 'string') {
      const match = sample.match(dashboardAuthIssuePattern);
      if (match) {
        return match[0];
      }
    }
  } catch (error) {
    log.warn('Dashboard auth probe failed', error);
  }

  return null;
}

async function clearDashboardOriginState(window: BrowserWindow): Promise<void> {
  try {
    await window.webContents.session.clearStorageData({
      origin: desktopConfig.gateway.baseUrl,
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers'],
    });
  } catch (error) {
    log.warn('Failed to clear dashboard origin storage', error);
  }
}

async function loadRecoveryPage(window: BrowserWindow, state?: GatewayState): Promise<void> {
  if (state) {
    latestGatewayState = state;
  }

  await window.loadFile(statusPagePath);
}

async function tryLoadDashboard(window: BrowserWindow): Promise<boolean> {
  const dashboardUrl = (await getDashboardLaunchUrl()) ?? desktopConfig.dashboard.url;
  log.info('Loading dashboard', { dashboardUrl });

  // Clear stale cache/storage to ensure a clean load.
  try {
    await window.webContents.session.clearCache();
    await window.webContents.session.clearStorageData({
      origin: new URL(dashboardUrl).origin,
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
    });
  } catch (error) {
    log.warn('Failed to clear session data before dashboard load', error);
  }

  // The dashboard SPA reads #token=... from the URL hash on initial load.
  try {
    await window.loadURL(dashboardUrl);
  } catch (error) {
    log.error('Failed to load dashboard URL', error);
    return false;
  }

  // Inject custom window controls (frameless window).
  try {
    await window.webContents.insertCSS(`
      #oc-titlebar {
        position: fixed; top: 0; right: 0; z-index: 99999;
        display: flex; align-items: center; height: 32px;
        -webkit-app-region: no-drag; user-select: none;
      }
      #oc-titlebar button {
        background: transparent; border: none; color: #94a3b8;
        width: 46px; height: 32px; font-size: 14px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      }
      #oc-titlebar button:hover { background: rgba(148,163,184,0.15); }
      #oc-titlebar button.close:hover { background: #e11d48; color: #fff; }
      html { --oc-titlebar-h: 32px; }
      body { margin-top: var(--oc-titlebar-h) !important; }
      #oc-drag-region {
        position: fixed; top: 0; left: 0; right: 0;
        height: var(--oc-titlebar-h); z-index: 99998;
        -webkit-app-region: drag; background: #0f172a;
      }
    `);
    await window.webContents.executeJavaScript(`(() => {
      if (document.getElementById('oc-titlebar')) return;
      const bar = document.createElement('div');
      bar.id = 'oc-titlebar';
      bar.innerHTML =
        '<button onclick="window.openclawDesktop.minimizeWindow()" title="Minimize">&#x2013;</button>' +
        '<button onclick="window.openclawDesktop.maximizeWindow()" title="Maximize">&#x25A1;</button>' +
        '<button class="close" onclick="window.openclawDesktop.closeWindow()" title="Close">&#x2715;</button>';
      document.body.appendChild(bar);
      const drag = document.createElement('div');
      drag.id = 'oc-drag-region';
      document.body.appendChild(drag);
    })()`, true);
  } catch (error) {
    log.warn('Failed to inject window controls', error);
  }

  return true;
}

async function loadBestAvailableView(window: BrowserWindow): Promise<void> {
  latestGatewayState = await checkGatewayHealth();

  if (!latestGatewayState.healthy) {
    const startResult = await startGatewayIntegrationPoint();
    latestGatewayState = startResult.state ?? latestGatewayState;
  }

  if (latestGatewayState.healthy && (await tryLoadDashboard(window))) {
    return;
  }

  await loadRecoveryPage(window, latestGatewayState);
}

async function applyGatewayStateToWindow(window: BrowserWindow, state: GatewayState): Promise<void> {
  latestGatewayState = state;

  if (state.healthy && (await tryLoadDashboard(window))) {
    return;
  }

  await loadRecoveryPage(window, latestGatewayState);
}

function showWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  showWindow();
});

app.whenReady().then(async () => {
  mainWindow = createMainWindow();

  const tray = createTray({
    onOpenDashboard: () => {
      showWindow();
      void loadBestAvailableView(mainWindow!);
    },
    onRefreshGateway: () => {
      void checkGatewayHealth().then((state) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          void applyGatewayStateToWindow(mainWindow, state);
        } else {
          latestGatewayState = state;
        }
      });
    },
    onQuit: () => {
      isQuitting = true;
      tray.destroy();
      app.quit();
    },
  });

  await loadBestAvailableView(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      void loadBestAvailableView(mainWindow);
    } else {
      showWindow();
    }
  });
});

ipcMain.handle('gateway:get-state', async () => latestGatewayState ?? checkGatewayHealth());
ipcMain.handle('gateway:refresh-state', async () => {
  const state = await checkGatewayHealth();

  if (mainWindow && !mainWindow.isDestroyed()) {
    await applyGatewayStateToWindow(mainWindow, state);
  } else {
    latestGatewayState = state;
  }

  return latestGatewayState ?? state;
});
ipcMain.handle('gateway:start', async () => {
  const result = await startGatewayIntegrationPoint();
  if (result.state) {
    latestGatewayState = result.state;
    if (mainWindow && !mainWindow.isDestroyed()) {
      await applyGatewayStateToWindow(mainWindow, result.state);
    }
  }
  return result;
});
ipcMain.handle('gateway:stop', async () => {
  const result = await stopGatewayIntegrationPoint();
  if (result.state) {
    latestGatewayState = result.state;
    if (mainWindow && !mainWindow.isDestroyed()) {
      await loadRecoveryPage(mainWindow, result.state);
    }
  }
  return result;
});
ipcMain.handle('gateway:restart', async () => {
  const result = await restartGatewayIntegrationPoint();
  if (result.state) {
    latestGatewayState = result.state;
    if (mainWindow && !mainWindow.isDestroyed()) {
      await applyGatewayStateToWindow(mainWindow, result.state);
    }
  }
  return result;
});
ipcMain.handle('window:show-dashboard', async () => {
  showWindow();
  if (mainWindow) {
    await loadBestAvailableView(mainWindow);
  }
});
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow?.close());

app.on('window-all-closed', () => {
  // Keep running in the tray on Windows.
});

app.on('before-quit', () => {
  isQuitting = true;
});
