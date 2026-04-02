import path from 'node:path';
import os from 'node:os';

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
  };
  dashboard: {
    url: string;
  };
};

const userHome = os.homedir();
const appData = process.env.APPDATA ?? path.join(userHome, 'AppData', 'Roaming');
const npmBinDir = path.join(appData, 'npm');

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
  },
  dashboard: {
    url: process.env.OPENCLAW_DASHBOARD_URL ?? 'http://127.0.0.1:18789/',
  },
};

export function getGatewayHealthUrl(): string {
  return new URL(desktopConfig.gateway.healthPath, `${desktopConfig.gateway.baseUrl}/`).toString();
}

export function getGatewayStatusUrl(): string {
  return new URL(desktopConfig.gateway.statusPath, `${desktopConfig.gateway.baseUrl}/`).toString();
}
