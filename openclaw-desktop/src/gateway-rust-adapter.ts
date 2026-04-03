/**
 * Rust runtime adapter — implements the same gateway interface as gateway.ts
 * but communicates with the openclaw-rs binary via HTTP control plane and
 * direct process management instead of CLI commands.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import log from 'electron-log/main';
import { desktopConfig, getGatewayHealthUrl, getGatewayStatusUrl } from './config';
import type {
  GatewayState,
  GatewayStateKind,
  GatewayLaunchResult,
  GatewayRuntimeFacts,
} from './gateway';

let rustProcess: ChildProcess | null = null;
let rustProcessPid: number | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function postRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  // Only target the Rust HTTP control port — never fall back to the stock gateway
  // to avoid accidentally shutting down or affecting the wrong runtime.
  const rpcUrl = `http://127.0.0.1:${desktopConfig.gateway.httpControlPort}/rpc`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), desktopConfig.gateway.commandTimeoutMs);

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: `desktop-${Date.now()}`, method, params }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      return response.json();
    }

    throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  } catch (error) {
    clearTimeout(timeout);
    throw new Error(`RPC call ${method} failed: ${normalizeError(error)}`);
  }
}

/**
 * Map the Rust runtime's health response to a GatewayRuntimeFacts.
 *
 * Rust /health returns: { ok: true, result: { ok: true, service, version, ts, uptimeMs, sessions, memory } }
 * Rust /status returns: { ok: true, result: { ... runtime status details ... } }
 */
function parseRustHealthPayload(payload: unknown): GatewayRuntimeFacts {
  const result =
    typeof payload === 'object' && payload && 'result' in payload
      ? (payload as { result: Record<string, unknown> }).result
      : (payload as Record<string, unknown>);

  return {
    serviceRegistered: true,
    serviceType: 'openclaw-rs (Rust runtime)',
    runtimeRunning: true,
    rpcProbeOk: true,
    listeningAddress: `127.0.0.1:${desktopConfig.gateway.httpControlPort}`,
    port: desktopConfig.gateway.httpControlPort,
    healthSummary:
      typeof result === 'object' && result
        ? `${(result as Record<string, unknown>).service ?? 'openclaw-rs'} v${(result as Record<string, unknown>).version ?? 'unknown'}`
        : undefined,
  };
}

function summarizeRustHealthDetail(payload: unknown, facts: GatewayRuntimeFacts): string {
  const parts: string[] = [];

  if (facts.healthSummary) {
    parts.push(facts.healthSummary);
  }

  parts.push('Rust runtime');

  if (facts.runtimeRunning) {
    parts.push('running');
  }

  if (facts.rpcProbeOk) {
    parts.push('RPC ok');
  }

  return parts.join(' | ');
}

export async function checkGatewayHealth(): Promise<GatewayState> {
  const checkedAt = new Date().toISOString();

  let healthPayload: unknown;
  let healthError: string | null = null;

  try {
    healthPayload = await fetchJson(getGatewayHealthUrl(), desktopConfig.gateway.healthTimeoutMs);
  } catch (error) {
    healthError = normalizeError(error);
  }

  if (healthPayload !== undefined) {
    const facts = parseRustHealthPayload(healthPayload);
    return {
      healthy: true,
      kind: 'healthy',
      url: desktopConfig.gateway.baseUrl,
      checkedAt,
      detail: summarizeRustHealthDetail(healthPayload, facts),
      payload: healthPayload,
      facts,
      checks: {
        httpHealth: 'ok',
        cliStatus: 'skipped',
        cliHealth: 'skipped',
      },
    };
  }

  // Check if the binary exists at all.
  if (!existsSync(desktopConfig.gateway.rustBinaryPath)) {
    return {
      healthy: false,
      kind: 'cli-missing',
      url: desktopConfig.gateway.baseUrl,
      checkedAt,
      detail: `Rust runtime binary not found at ${desktopConfig.gateway.rustBinaryPath}`,
      checks: {
        httpHealth: 'failed',
        cliStatus: 'failed',
        cliHealth: 'skipped',
      },
    };
  }

  // Binary exists but health check failed — runtime not running.
  const kind: GatewayStateKind = rustProcessPid ? 'unreachable' : 'stopped';
  return {
    healthy: false,
    kind,
    url: desktopConfig.gateway.baseUrl,
    checkedAt,
    detail: healthError
      ? `Rust runtime HTTP health unreachable: ${healthError}`
      : 'Rust runtime not responding.',
    checks: {
      httpHealth: 'failed',
      cliStatus: 'skipped',
      cliHealth: 'skipped',
    },
  };
}

async function waitForHealthy(timeoutMs: number): Promise<GatewayState | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await checkGatewayHealth();
    if (state.healthy) {
      return state;
    }
    await delay(desktopConfig.gateway.pollIntervalMs);
  }
  return null;
}

async function waitForStopped(timeoutMs: number): Promise<GatewayState | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await checkGatewayHealth();
    if (!state.healthy && state.kind === 'stopped') {
      return state;
    }
    await delay(desktopConfig.gateway.pollIntervalMs);
  }
  return null;
}

export async function startGatewayIntegrationPoint(): Promise<GatewayLaunchResult> {
  const existingState = await checkGatewayHealth();

  if (existingState.healthy) {
    return {
      attempted: false,
      action: 'noop',
      ok: true,
      message: 'Rust runtime already appears healthy.',
      state: existingState,
    };
  }

  const binaryPath = desktopConfig.gateway.rustBinaryPath;
  if (!existsSync(binaryPath)) {
    return {
      attempted: true,
      action: 'start',
      ok: false,
      message: `Rust runtime binary not found at ${binaryPath}`,
      state: existingState,
    };
  }

  log.info('Starting Rust runtime', { binaryPath, config: desktopConfig.gateway.rustConfigPath });

  try {
    const args = ['run'];
    if (existsSync(desktopConfig.gateway.rustConfigPath)) {
      args.push('--config', desktopConfig.gateway.rustConfigPath);
    }

    rustProcess = spawn(binaryPath, args, {
      cwd: desktopConfig.gateway.workingDirectory,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    rustProcessPid = rustProcess.pid ?? null;

    rustProcess.on('error', (error) => {
      log.error('Rust runtime process error', { error: normalizeError(error), pid: rustProcessPid });
      rustProcess = null;
      rustProcessPid = null;
    });

    rustProcess.on('exit', (code) => {
      log.info('Rust runtime process exited', { code, pid: rustProcessPid });
      rustProcess = null;
      rustProcessPid = null;
    });

    rustProcess.unref();
  } catch (error) {
    return {
      attempted: true,
      action: 'start',
      ok: false,
      message: `Failed to spawn Rust runtime: ${normalizeError(error)}`,
      state: await checkGatewayHealth(),
    };
  }

  const settledState = await waitForHealthy(desktopConfig.gateway.startTimeoutMs);
  if (settledState) {
    return {
      attempted: true,
      action: 'start',
      ok: true,
      message: 'Rust runtime started and responding to health checks.',
      state: settledState,
    };
  }

  const fallbackState = await checkGatewayHealth();
  return {
    attempted: true,
    action: 'start',
    ok: false,
    message: `Rust runtime spawned but did not become healthy within timeout. Current state: ${fallbackState.kind}.`,
    state: fallbackState,
  };
}

export async function stopGatewayIntegrationPoint(): Promise<GatewayLaunchResult> {
  const existingState = await checkGatewayHealth();

  if (!existingState.healthy && existingState.kind === 'stopped') {
    return {
      attempted: false,
      action: 'noop',
      ok: true,
      message: 'Rust runtime already stopped.',
      state: existingState,
    };
  }

  log.info('Stopping Rust runtime');

  // Try graceful shutdown via RPC first.
  try {
    await postRpc('gateway.shutdown');
    log.info('Shutdown RPC sent successfully');
  } catch (error) {
    log.warn('Shutdown RPC failed, falling back to process kill', error);

    // Fall back to killing the tracked process.
    if (rustProcessPid) {
      try {
        process.kill(rustProcessPid, 'SIGTERM');
      } catch {
        // Process may already be gone.
      }
    }
  }

  const settledState = await waitForStopped(desktopConfig.gateway.stopTimeoutMs);
  if (settledState) {
    rustProcess = null;
    rustProcessPid = null;
    return {
      attempted: true,
      action: 'stop',
      ok: true,
      message: 'Rust runtime stopped.',
      state: settledState,
    };
  }

  const fallbackState = await checkGatewayHealth();
  return {
    attempted: true,
    action: 'stop',
    ok: false,
    message: `Rust runtime stop attempted but did not settle into stopped state. Current state: ${fallbackState.kind}.`,
    state: fallbackState,
  };
}

export async function restartGatewayIntegrationPoint(): Promise<GatewayLaunchResult> {
  const stopResult = await stopGatewayIntegrationPoint();
  if (!stopResult.ok && stopResult.attempted) {
    log.warn('Stop phase of restart did not succeed cleanly', stopResult.message);
  }

  return startGatewayIntegrationPoint();
}

export async function getDashboardLaunchUrl(): Promise<string | null> {
  const httpControlUrl = `http://127.0.0.1:${desktopConfig.gateway.httpControlPort}`;
  const token = desktopConfig.gateway.rustToken;

  if (token) {
    return `${httpControlUrl}/#token=${token}`;
  }

  return `${httpControlUrl}/`;
}
