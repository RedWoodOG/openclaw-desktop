import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import log from 'electron-log/main';
import { desktopConfig, getGatewayHealthUrl } from './config';

const execAsync = promisify(exec);

type GatewayCommandName = 'status' | 'health' | 'start' | 'stop' | 'restart' | 'dashboard';

export type GatewayStateKind =
  | 'healthy'
  | 'starting'
  | 'stopped'
  | 'unreachable'
  | 'cli-missing'
  | 'startup-failed'
  | 'auth-required'
  | 'status-unknown';

export type GatewayCommandResult = {
  ok: boolean;
  command: GatewayCommandName;
  args: string[];
  output: string;
  durationMs: number;
  exitCode?: number | null;
  error?: string;
};

export type GatewayRuntimeFacts = {
  serviceRegistered: boolean;
  serviceType?: string;
  serviceFile?: string;
  fileLogsPath?: string;
  configPath?: string;
  serviceConfigPath?: string;
  dashboardUrl?: string;
  listeningAddress?: string;
  bindMode?: string;
  port?: number;
  runtimeRunning?: boolean;
  rpcProbeOk?: boolean;
  listenerDetected?: boolean;
  healthSummary?: string;
  providers?: string[];
};

export type GatewayState = {
  healthy: boolean;
  kind: GatewayStateKind;
  url: string;
  checkedAt: string;
  detail?: string;
  payload?: unknown;
  facts?: GatewayRuntimeFacts;
  checks: {
    httpHealth: 'ok' | 'failed' | 'skipped';
    cliStatus: 'ok' | 'failed' | 'skipped';
    cliHealth: 'ok' | 'failed' | 'skipped';
  };
  commandResults?: Partial<Record<GatewayCommandName, GatewayCommandResult>>;
};

export type GatewayControlAction = 'start' | 'stop' | 'restart';

export type GatewayLaunchResult = {
  attempted: boolean;
  action: GatewayControlAction | 'noop';
  ok: boolean;
  message: string;
  state?: GatewayState;
  command?: GatewayCommandResult;
};

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

async function runGatewayCommand(command: GatewayCommandName): Promise<GatewayCommandResult> {
  const startedAt = Date.now();
  const args = command === 'dashboard' ? ['dashboard', '--no-open'] : ['gateway', command];
  const cmdLine = `"${desktopConfig.gateway.launchCommand}" ${args.join(' ')}`;

  try {
    const { stdout, stderr } = await execAsync(cmdLine, {
      cwd: desktopConfig.gateway.workingDirectory,
      windowsHide: true,
      timeout: desktopConfig.gateway.commandTimeoutMs,
    });

    return {
      ok: true,
      command,
      args,
      output: `${stdout ?? ''}${stderr ?? ''}`.trim(),
      durationMs: Date.now() - startedAt,
      exitCode: 0,
    };
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };

    return {
      ok: false,
      command,
      args,
      output: `${commandError.stdout ?? ''}${commandError.stderr ?? ''}`.trim(),
      durationMs: Date.now() - startedAt,
      exitCode: typeof commandError.code === 'number' ? commandError.code : null,
      error: normalizeError(error),
    };
  }
}

function extractMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1]?.trim();
}

function parsePort(raw?: string): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseGatewayFacts(statusOutput: string, healthOutput?: string): GatewayRuntimeFacts {
  const providers = Array.from(
    new Set(
      (healthOutput ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /: ok/i.test(line) && !/^gateway health$/i.test(line) && !/^ok \(/i.test(line))
        .map((line) => line.replace(/: ok.*$/i, '')),
    ),
  );

  return {
    serviceRegistered: /service:\s+/i.test(statusOutput) && !/service:\s+not installed/i.test(statusOutput),
    serviceType: extractMatch(statusOutput, /^Service:\s*(.+)$/im),
    serviceFile: extractMatch(statusOutput, /^Service file:\s*(.+)$/im),
    fileLogsPath: extractMatch(statusOutput, /^File logs:\s*(.+)$/im),
    configPath: extractMatch(statusOutput, /^Config \(cli\):\s*(.+)$/im),
    serviceConfigPath: extractMatch(statusOutput, /^Config \(service\):\s*(.+)$/im),
    dashboardUrl: extractMatch(statusOutput, /^Dashboard:\s*(.+)$/im),
    listeningAddress: extractMatch(statusOutput, /^Listening:\s*(.+)$/im),
    bindMode: extractMatch(statusOutput, /^Gateway:\s*bind=([^,]+),/im),
    port: parsePort(extractMatch(statusOutput, /^Gateway:\s*bind=[^,]+,\s*port=(\d+)/im)),
    runtimeRunning: /runtime:\s+running/i.test(statusOutput),
    rpcProbeOk: /rpc probe:\s+ok/i.test(statusOutput),
    listenerDetected: /listener detected on port/i.test(statusOutput),
    healthSummary: extractMatch(healthOutput ?? '', /^OK\s*\((.+)\)$/im),
    providers,
  };
}

function summarizeHealthyDetail(payload: unknown, facts?: GatewayRuntimeFacts): string {
  const summaryParts: string[] = [];

  if (typeof payload === 'object' && payload && 'status' in payload) {
    const statusValue = (payload as { status?: unknown }).status;
    if (typeof statusValue === 'string') {
      summaryParts.push(`HTTP health status=${statusValue}`);
    }
  }

  if (facts?.serviceType) {
    summaryParts.push(facts.serviceType);
  }

  if (facts?.runtimeRunning) {
    summaryParts.push('runtime running');
  }

  if (facts?.rpcProbeOk) {
    summaryParts.push('RPC probe ok');
  }

  if (facts?.providers?.length) {
    summaryParts.push(`providers: ${facts.providers.join(', ')}`);
  }

  return summaryParts.join(' | ');
}

export async function checkGatewayHealth(): Promise<GatewayState> {
  const checkedAt = new Date().toISOString();
  const statusCommand = await runGatewayCommand('status');
  const facts = parseGatewayFacts(statusCommand.output);

  let healthPayload: unknown;
  let healthError: string | null = null;

  try {
    healthPayload = await fetchJson(getGatewayHealthUrl(), desktopConfig.gateway.healthTimeoutMs);
  } catch (error) {
    healthError = normalizeError(error);
  }

  const healthCommand = facts.runtimeRunning ? await runGatewayCommand('health') : null;
  const combinedFacts = parseGatewayFacts(statusCommand.output, healthCommand?.output);

  if (healthPayload !== undefined) {
    return {
      healthy: true,
      kind: 'healthy',
      url: desktopConfig.gateway.baseUrl,
      checkedAt,
      detail: summarizeHealthyDetail(healthPayload, combinedFacts),
      payload: healthPayload,
      facts: combinedFacts,
      checks: {
        httpHealth: 'ok',
        cliStatus: statusCommand.ok ? 'ok' : 'failed',
        cliHealth: healthCommand?.ok ? 'ok' : healthCommand ? 'failed' : 'skipped',
      },
      commandResults: {
        status: statusCommand,
        health: healthCommand ?? undefined,
      },
    };
  }

  if (!statusCommand.ok && /ENOENT|not recognized|cannot find/i.test(`${statusCommand.error ?? ''} ${statusCommand.output}`)) {
    return {
      healthy: false,
      kind: 'cli-missing',
      url: desktopConfig.gateway.baseUrl,
      checkedAt,
      detail: `OpenClaw CLI not found at ${desktopConfig.gateway.launchCommand}`,
      facts: combinedFacts,
      checks: {
        httpHealth: 'failed',
        cliStatus: 'failed',
        cliHealth: 'skipped',
      },
      commandResults: {
        status: statusCommand,
      },
    };
  }

  if (combinedFacts.runtimeRunning) {
    return {
      healthy: false,
      kind: 'unreachable',
      url: desktopConfig.gateway.baseUrl,
      checkedAt,
      detail: healthCommand?.ok
        ? `Gateway service reports running but HTTP health is unreachable: ${healthError ?? 'unknown error'}`
        : `Gateway service reports running, but health verification failed: ${healthError ?? healthCommand?.error ?? 'unknown error'}`,
      payload: healthCommand?.output || statusCommand.output,
      facts: combinedFacts,
      checks: {
        httpHealth: 'failed',
        cliStatus: statusCommand.ok ? 'ok' : 'failed',
        cliHealth: healthCommand?.ok ? 'ok' : healthCommand ? 'failed' : 'skipped',
      },
      commandResults: {
        status: statusCommand,
        health: healthCommand ?? undefined,
      },
    };
  }

  return {
    healthy: false,
    kind: statusCommand.ok ? 'stopped' : 'status-unknown',
    url: desktopConfig.gateway.baseUrl,
    checkedAt,
    detail: healthError
      ? `HTTP health unreachable: ${healthError}`
      : statusCommand.output || statusCommand.error || 'Gateway did not report as healthy.',
    payload: statusCommand.output || undefined,
    facts: combinedFacts,
    checks: {
      httpHealth: 'failed',
      cliStatus: statusCommand.ok ? 'ok' : 'failed',
      cliHealth: 'skipped',
    },
    commandResults: {
      status: statusCommand,
    },
  };
}

async function waitForGatewayHealthy(timeoutMs: number): Promise<GatewayState | null> {
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

async function waitForGatewayStopped(timeoutMs: number): Promise<GatewayState | null> {
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

async function runGatewayControl(action: GatewayControlAction): Promise<GatewayLaunchResult> {
  const existingState = await checkGatewayHealth();

  if (action === 'start' && existingState.healthy) {
    return {
      attempted: false,
      action: 'noop',
      ok: true,
      message: 'Gateway already appears healthy.',
      state: existingState,
    };
  }

  log.info('Gateway control invoked', {
    action,
    launchCommand: desktopConfig.gateway.launchCommand,
    workingDirectory: desktopConfig.gateway.workingDirectory,
  });

  const command = await runGatewayCommand(action);
  if (!command.ok) {
    return {
      attempted: true,
      action,
      ok: false,
      message: `${action} command failed: ${command.error ?? 'unknown error'}`,
      command,
      state: await checkGatewayHealth(),
    };
  }

  const settledState =
    action === 'stop'
      ? await waitForGatewayStopped(desktopConfig.gateway.stopTimeoutMs)
      : await waitForGatewayHealthy(desktopConfig.gateway.startTimeoutMs);

  if (settledState) {
    return {
      attempted: true,
      action,
      ok: action === 'stop' ? settledState.kind === 'stopped' : settledState.healthy,
      message:
        action === 'stop'
          ? 'Gateway stop command completed and the service looks stopped.'
          : `Gateway ${action} command completed and the gateway answered during verification.`,
      command,
      state: settledState,
    };
  }

  const fallbackState = await checkGatewayHealth();
  const fallbackKind = fallbackState.kind;
  return {
    attempted: true,
    action,
    ok: false,
    message:
      action === 'stop'
        ? `Gateway stop command ran, but the runtime did not settle into a stopped state before timeout. Current state: ${fallbackKind}.`
        : `Gateway ${action} command ran, but the gateway did not become healthy before timeout. Current state: ${fallbackKind}.`,
    command,
    state: fallbackState,
  };
}

export async function startGatewayIntegrationPoint(): Promise<GatewayLaunchResult> {
  return runGatewayControl('start');
}

export async function stopGatewayIntegrationPoint(): Promise<GatewayLaunchResult> {
  return runGatewayControl('stop');
}

export async function restartGatewayIntegrationPoint(): Promise<GatewayLaunchResult> {
  return runGatewayControl('restart');
}

export async function getDashboardLaunchUrl(): Promise<string | null> {
  const command = await runGatewayCommand('dashboard');
  if (!command.ok) {
    log.warn('Failed to resolve tokenized dashboard URL', command);
    return null;
  }

  const lineMatch = command.output.match(/^Dashboard URL:\s*(.+)$/im)?.[1]?.trim();
  const urlMatch = command.output.match(/https?:\/\/[^\s"']+/i)?.[0]?.trim();
  const url = lineMatch ?? urlMatch ?? null;

  if (!url) {
    log.warn('Dashboard command succeeded without a parseable URL', { output: command.output });
    return null;
  }

  return url;
}
