import path from 'node:path';
import os from 'node:os';

export type RuntimeBackend = 'stock' | 'rust';

export type DesktopConfig = {
  appName: string;
  appUserModelId: string;
  defaultWindow: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  };
  gateway: {
    backend: RuntimeBackend;
    baseUrl: string;
    healthPath: string;
    statusPath: string;
    launchCommand: string;
    workingDirectory: string;
    healthTimeoutMs: number;
    commandTimeoutMs: number;
    startTimeoutMs: number;
    stopTimeoutMs: number;
    pollIntervalMs: number;
    rustBinaryPath: string;
    rustConfigPath: string;
    httpControlPort: number;
    rustToken: string | undefined;
  };
  dashboard: {
    url: string;
  };
};

const userHome = os.homedir();
const appData = process.env.APPDATA ?? path.join(userHome, 'AppData', 'Roaming');
const npmBinDir = path.join(appData, 'npm');

const resolvedBackend = (process.env.OPENCLAW_RUNTIME_BACKEND ?? 'stock') as RuntimeBackend;
const rustHttpControlPort = Number.parseInt(process.env.OPENCLAW_RS_HTTP_PORT ?? '18890', 10);

export const desktopConfig: DesktopConfig = {
  appName: 'OpenClaw Desktop',
  appUserModelId: 'com.openclaw.desktop',
  defaultWindow: {
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
  },
  gateway: {
    backend: resolvedBackend === 'rust' ? 'rust' : 'stock',
    baseUrl: process.env.OPENCLAW_GATEWAY_URL ?? 'http://127.0.0.1:18789',
    healthPath: process.env.OPENCLAW_GATEWAY_HEALTH_PATH ?? '/health',
    statusPath: process.env.OPENCLAW_GATEWAY_STATUS_PATH ?? '/status',
    launchCommand: process.env.OPENCLAW_CLI_PATH ?? path.join(npmBinDir, 'openclaw.cmd'),
    workingDirectory: process.env.OPENCLAW_WORKDIR ?? path.join(userHome, '.openclaw'),
    healthTimeoutMs: 2500,
    commandTimeoutMs: 12000,
    startTimeoutMs: 20000,
    stopTimeoutMs: 15000,
    pollIntervalMs: 1000,
    rustBinaryPath: process.env.OPENCLAW_RS_BINARY_PATH ?? path.join(userHome, '.openclaw', 'bin', 'openclaw-rs.exe'),
    rustConfigPath: process.env.OPENCLAW_RS_CONFIG ?? path.join(userHome, '.openclaw', 'openclaw-rs.toml'),
    httpControlPort: Number.isFinite(rustHttpControlPort) ? rustHttpControlPort : 18890,
    rustToken: process.env.OPENCLAW_RS_GATEWAY_TOKEN,
  },
  dashboard: {
    url: process.env.OPENCLAW_DASHBOARD_URL ?? 'http://127.0.0.1:18789/',
  },
};

export function getGatewayHttpControlUrl(): string {
  if (desktopConfig.gateway.backend === 'rust') {
    return `http://127.0.0.1:${desktopConfig.gateway.httpControlPort}`;
  }
  return desktopConfig.gateway.baseUrl;
}

export function getGatewayHealthUrl(): string {
  const base = getGatewayHttpControlUrl();
  return new URL(desktopConfig.gateway.healthPath, `${base}/`).toString();
}

export function getGatewayStatusUrl(): string {
  const base = getGatewayHttpControlUrl();
  return new URL(desktopConfig.gateway.statusPath, `${base}/`).toString();
}
