import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export type TrayHandlers = {
  onOpenDashboard: () => void;
  onRefreshGateway: () => void;
  onQuit: () => void;
};

function resolveTrayIconPath(): string {
  const preferred = [
    path.join(__dirname, '..', 'build', 'tray-icon.png'),
    path.join(__dirname, '..', 'renderer', 'trayTemplate.png'),
  ];

  const existing = preferred.find((candidate) => fs.existsSync(candidate));
  if (!existing) {
    throw new Error(`No tray icon found. Checked: ${preferred.join(', ')}`);
  }

  return existing;
}

export function createTray(handlers: TrayHandlers): Tray {
  const trayIconPath = resolveTrayIconPath();
  const tray = new Tray(nativeImage.createFromPath(trayIconPath));

  tray.setToolTip('OpenClaw Desktop');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: handlers.onOpenDashboard },
      { label: 'Refresh Gateway Status', click: handlers.onRefreshGateway },
      { type: 'separator' },
      { label: 'Quit', click: handlers.onQuit },
    ]),
  );

  tray.on('double-click', handlers.onOpenDashboard);
  return tray;
}
