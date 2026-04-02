import { contextBridge, ipcRenderer } from 'electron';
import type { GatewayLaunchResult, GatewayState } from './gateway';

const api = {
  getGatewayState: (): Promise<GatewayState> => ipcRenderer.invoke('gateway:get-state'),
  refreshGatewayState: (): Promise<GatewayState> => ipcRenderer.invoke('gateway:refresh-state'),
  startGateway: (): Promise<GatewayLaunchResult> => ipcRenderer.invoke('gateway:start'),
  stopGateway: (): Promise<GatewayLaunchResult> => ipcRenderer.invoke('gateway:stop'),
  restartGateway: (): Promise<GatewayLaunchResult> => ipcRenderer.invoke('gateway:restart'),
  showDashboard: (): Promise<void> => ipcRenderer.invoke('window:show-dashboard'),
  minimizeWindow: (): void => { ipcRenderer.send('window:minimize'); },
  maximizeWindow: (): void => { ipcRenderer.send('window:maximize'); },
  closeWindow: (): void => { ipcRenderer.send('window:close'); },
};

contextBridge.exposeInMainWorld('openclawDesktop', api);

declare global {
  interface Window {
    openclawDesktop: typeof api;
  }
}
