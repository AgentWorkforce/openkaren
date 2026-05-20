import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commandAvailable, rtkStatus } from './token-tools.js';
import { redactSecretText } from './redaction.js';

export type DoctorSeverity = 'required' | 'optional';
export type DoctorStatus = 'pass' | 'warn' | 'fail';

export type DoctorCheck = {
  id: string;
  label: string;
  severity: DoctorSeverity;
  status: DoctorStatus;
  message: string;
  remediation?: string;
};

export type DoctorSectionId = 'runtime' | 'config' | 'execution' | 'tokenTools';

export type DoctorReport = {
  ok: boolean;
  requiredFailures: number;
  sections: Record<DoctorSectionId, DoctorCheck[]>;
};

type DoctorOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

type DoctorEnv = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  packageJson: {
    version?: string;
    engines?: {
      node?: string;
    };
  } | null;
  mcpConfig: Record<string, unknown> | null;
};

const DEFAULT_DASHBOARD_PATH = '/dashboard';
const DEFAULT_RELAYCAST_HOST = '127.0.0.1';
const DEFAULT_RELAYCAST_PORT = 7528;
const DEFAULT_RELAY_CLI = 'codex';
const DEFAULT_RELAY_WORKFLOW = 'orchestrated';
const DEFAULT_RTK_COMMAND = 'rtk';
const DEFAULT_BURN_COMMAND = 'burn';
const DEFAULT_TOKENSAVE_COMMAND = 'tokensave';

// Stable JSON shape:
// { ok, requiredFailures, sections: { runtime, config, execution, tokenTools } }
// Each section entry is { id, label, severity, status, message, remediation? }.
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = resolveDoctorEnv(options.env ?? process.env, cwd);
  const context: DoctorEnv = {
    cwd,
    env,
    packageJson: readPackageJson(cwd),
    mcpConfig: readJsonFile(join(cwd, '.mcp.json')),
  };

  const sections: DoctorReport['sections'] = {
    runtime: await runtimeChecks(context),
    config: await configChecks(context),
    execution: await executionChecks(context),
    tokenTools: await tokenToolChecks(context),
  };
  const requiredFailures = Object.values(sections)
    .flat()
    .filter((check) => check.severity === 'required' && check.status === 'fail')
    .length;

  return {
    ok: requiredFailures === 0,
    requiredFailures,
    sections,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    report.ok
      ? 'OpenKaren doctor passed required checks.'
      : `OpenKaren doctor found ${report.requiredFailures} required blocker${report.requiredFailures === 1 ? '' : 's'}.`,
  ];

  for (const [section, checks] of Object.entries(report.sections)) {
    lines.push('', section);
    for (const check of checks) {
      const marker = check.status === 'pass' ? 'ok' : check.status === 'warn' ? 'warn' : 'fail';
      lines.push(`${marker} ${check.label}: ${check.message}`);
      if (check.remediation) {
        lines.push(`  fix: ${check.remediation}`);
      }
    }
  }

  return lines.join('\n');
}

async function runtimeChecks(context: DoctorEnv): Promise<DoctorCheck[]> {
  const nodeRequirement = context.packageJson?.engines?.node ?? '>=22';
  return [
    check(
      'node',
      'Node.js',
      'required',
      nodeSatisfies(process.versions.node, nodeRequirement) ? 'pass' : 'fail',
      `running ${process.versions.node}; package requires ${nodeRequirement}`,
      `install Node ${nodeRequirement}`,
    ),
    check(
      'package',
      'package version',
      'required',
      context.packageJson?.version ? 'pass' : 'fail',
      context.packageJson?.version
        ? `openkaren ${context.packageJson.version}`
        : 'package.json could not be read',
      'run this command from the OpenKaren project root',
    ),
  ];
}

async function configChecks(context: DoctorEnv): Promise<DoctorCheck[]> {
  const dashboardEnabled = parseDashboardEnabled(context.env);
  const dashboardPath = context.env.OPENKAREN_DASHBOARD_PATH?.trim() || DEFAULT_DASHBOARD_PATH;
  const relaycastHost = context.env.OPENKAREN_RELAYCAST_HOST?.trim() || DEFAULT_RELAYCAST_HOST;
  const relaycastPort = positiveInt(context.env.OPENKAREN_RELAYCAST_PORT, DEFAULT_RELAYCAST_PORT);
  const portAvailable = dashboardEnabled
    ? await canListen(relaycastHost, relaycastPort)
    : true;
  const stateWorkerUrl = optionalEnv(context.env.OPENKAREN_STATE_WORKER_URL);
  const slackEnabled = booleanEnv(context.env.OPENKAREN_SLACK_ENABLED);
  const missingSlackKeys = slackEnabled ? missingEnabledSlackKeys(context.env) : [];
  const telegramAllowlist = parseListEnv(context.env.TELEGRAM_ALLOWED_CHAT_IDS);
  const slackAllowlist = parseListEnv(context.env.OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS);
  const nangoBaseUrl = optionalEnv(context.env.NANGO_BASE_URL ?? context.env.OPENKAREN_NANGO_BASE_URL);
  const nangoSecret = optionalEnv(context.env.NANGO_SECRET_KEY ?? context.env.OPENKAREN_NANGO_SECRET_KEY);

  return [
    check(
      'telegram',
      'Telegram config',
      'optional',
      optionalEnv(context.env.TELEGRAM_BOT_TOKEN) ? 'pass' : 'warn',
      optionalEnv(context.env.TELEGRAM_BOT_TOKEN)
        ? 'TELEGRAM_BOT_TOKEN is present'
        : 'TELEGRAM_BOT_TOKEN is not set; start will require it',
      'set TELEGRAM_BOT_TOKEN before running `karen start`',
    ),
    check(
      'telegram-allowlist',
      'Telegram allowlist',
      'optional',
      telegramAllowlist.length > 0 ? 'pass' : 'warn',
      telegramAllowlist.length > 0
        ? `TELEGRAM_ALLOWED_CHAT_IDS contains ${telegramAllowlist.length} chat id${telegramAllowlist.length === 1 ? '' : 's'}`
        : 'TELEGRAM_ALLOWED_CHAT_IDS is empty; any Telegram chat can reach this instance',
      'set TELEGRAM_ALLOWED_CHAT_IDS to the trusted chat ids before using real accounts',
    ),
    check(
      'dashboard',
      'dashboard port/path',
      'optional',
      dashboardEnabled && (!dashboardPath.startsWith('/') || !portAvailable || !isLocalhost(relaycastHost))
        ? 'warn'
        : 'pass',
      dashboardEnabled
        ? `${relaycastHost}:${relaycastPort}${dashboardPath} ${portAvailable ? 'is available' : 'is already in use'}; ${isLocalhost(relaycastHost) ? 'localhost-only' : 'not localhost-bound'}`
        : 'dashboard disabled',
      dashboardPath.startsWith('/')
        ? 'keep OPENKAREN_RELAYCAST_HOST on 127.0.0.1/localhost for production, set OPENKAREN_DASHBOARD=off, or set OPENKAREN_DASHBOARD_ENABLED=false'
        : 'set OPENKAREN_DASHBOARD_PATH to a path starting with /',
    ),
    check(
      'state-worker',
      'Cloudflare Worker state',
      'optional',
      stateWorkerUrl && !optionalEnv(context.env.OPENKAREN_STATE_AUTH_TOKEN ?? context.env.KAREN_STATE_TOKEN)
        ? 'warn'
        : 'pass',
      stateWorkerUrl
        ? 'state worker URL configured'
        : 'local in-memory state adapter active',
      'set OPENKAREN_STATE_AUTH_TOKEN or KAREN_STATE_TOKEN when OPENKAREN_STATE_WORKER_URL is set',
    ),
    check(
      'slack-channel-allowlist',
      'Slack channel allowlist',
      'optional',
      !slackEnabled || slackAllowlist.length > 0 ? 'pass' : 'warn',
      slackEnabled
        ? slackAllowlist.length > 0
          ? `OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS contains ${slackAllowlist.length} channel${slackAllowlist.length === 1 ? '' : 's'}`
          : 'OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS is empty; all signed Slack channels are accepted'
        : 'Slack surface disabled',
      'set OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS to trusted channel ids when enabling Slack',
    ),
    check(
      'slack',
      'Slack config',
      'optional',
      missingSlackKeys.length > 0 ? 'warn' : 'pass',
      slackEnabled
        ? missingSlackKeys.length > 0
          ? `Slack surface enabled; missing ${missingSlackKeys.join(', ')}`
          : 'Slack surface enabled'
        : 'Slack surface disabled',
      `set ${missingSlackKeys.length > 0 ? missingSlackKeys.join(' and ') : 'SLACK_BOT_TOKEN and OPENKAREN_SLACK_SIGNING_SECRET'} when enabling Slack`,
    ),
    check(
      'nango',
      'Nango config',
      'optional',
      nangoBaseUrl && !nangoSecret ? 'warn' : 'pass',
      nangoBaseUrl
        ? 'Nango base URL configured'
        : 'Nango OAuth backing not configured',
      'set NANGO_SECRET_KEY when NANGO_BASE_URL is set',
    ),
  ];
}

async function executionChecks(context: DoctorEnv): Promise<DoctorCheck[]> {
  const agentMode = parseAgentMode(context.env);
  const agentRelayCli = context.env.OPENKAREN_AGENT_RELAY_CLI?.trim() || DEFAULT_RELAY_CLI;
  const agentRelayWorkflow = context.env.OPENKAREN_AGENT_RELAY_WORKFLOW?.trim() || DEFAULT_RELAY_WORKFLOW;
  const agentRelaySdk = await importAvailable('@agent-relay/sdk');
  const rickySdk = await rickySdkAvailable();
  const burnSdk = await importAvailable('@relayburn/sdk');
  const burnCommand = context.env.OPENKAREN_BURN_COMMAND?.trim() || DEFAULT_BURN_COMMAND;

  return [
    check(
      'relay-mode',
      'relay mode',
      'required',
      agentMode === 'command' && !optionalEnv(context.env.OPENKAREN_AGENT_COMMAND) ? 'fail' : 'pass',
      agentMode === 'relay'
        ? `relay mode active; workflow=${agentRelayWorkflow}`
        : `agent mode=${agentMode}`,
      'set OPENKAREN_AGENT_COMMAND or use OPENKAREN_AGENT_MODE=relay',
    ),
    check(
      'agent-relay',
      'Agent Relay SDK',
      agentMode === 'relay' ? 'required' : 'optional',
      agentRelaySdk ? 'pass' : agentMode === 'relay' ? 'fail' : 'warn',
      agentRelaySdk
        ? `@agent-relay/sdk import works; caller route uses ${agentRelayCli}`
        : '@agent-relay/sdk import failed',
      'run npm install and keep local/cloud/MCP callers routed through @agent-relay/sdk artifacts',
    ),
    check(
      'ricky',
      'Ricky SDK',
      'required',
      rickySdk ? 'pass' : 'fail',
      rickySdk
        ? '@agentworkforce/ricky import works'
        : '@agentworkforce/ricky SDK unavailable',
      'run npm install and use createOpenKarenRicky(config) instead of shelling out to Ricky',
    ),
    check(
      'burn-cli',
      'Burn CLI',
      'optional',
      commandAvailable(burnCommand) ? 'pass' : 'warn',
      commandAvailable(burnCommand)
        ? `${burnCommand} is on PATH`
        : `${burnCommand} not on PATH; spend snapshots will fall back to unavailable`,
      'install relayburn or set OPENKAREN_BURN_COMMAND',
    ),
    check(
      'burn-sdk',
      'Burn SDK',
      'required',
      burnSdk ? 'pass' : 'fail',
      burnSdk ? '@relayburn/sdk import works' : '@relayburn/sdk import failed',
      'run npm install',
    ),
  ];
}

async function tokenToolChecks(context: DoctorEnv): Promise<DoctorCheck[]> {
  const rtkCommand = context.env.OPENKAREN_RTK_COMMAND?.trim() || DEFAULT_RTK_COMMAND;
  const tokensaveCommand = context.env.OPENKAREN_TOKENSAVE_COMMAND?.trim() || DEFAULT_TOKENSAVE_COMMAND;
  const rtk = rtkStatus(rtkCommand, { env: context.env });
  const rtkCollision = rtk.state === 'missing' && /unrelated npm package named rtk|not Rust Token Killer/i.test(rtk.detail);
  const tilthCommand = mcpServerCommand(context.mcpConfig, 'tilth');
  const tilthArgs = mcpServerArgs(context.mcpConfig, 'tilth');
  const tilthConfigured = tilthCommand !== null && tilthArgs.includes('--mcp');
  const tokensaveConfigured = mcpServerCommand(context.mcpConfig, 'tokensave') !== null;
  const tokensaveAvailable = commandAvailable(tokensaveCommand, { env: context.env });
  const tokensaveIndex = existsDir(join(context.cwd, '.tokensave'));
  const tokensaveDoctor = tokensaveAvailable
    ? runCommand(tokensaveCommand, ['doctor', '--agent', 'codex'], context.env)
    : null;

  return [
    check(
      'rtk',
      'RTK',
      rtkCollision ? 'required' : 'optional',
      rtk.state === 'available' ? 'pass' : rtkCollision ? 'fail' : 'warn',
      rtk.detail,
      rtk.state === 'available'
        ? undefined
        : 'install Rust Token Killer with `brew install rtk-ai/tap/rtk` or `cargo install --git https://github.com/rtk-ai/rtk rtk`; ensure it wins PATH over the unrelated npm package named `rtk`',
    ),
    check(
      'tilth-mcp',
      'Tilth MCP config',
      'optional',
      tilthConfigured ? 'pass' : 'warn',
      tilthConfigured
        ? `Tilth .mcp.json server is configured through ${tilthCommand}`
        : 'Tilth .mcp.json server is missing or does not pass --mcp',
      'run npm install and keep the tilth .mcp.json server configured with --mcp',
    ),
    check(
      'tokensave',
      'TokenSave',
      'optional',
      tokensaveAvailable && tokensaveConfigured && tokensaveIndex ? 'pass' : 'warn',
      tokensaveAvailable
        ? `TokenSave ${tokensaveIndex ? 'index exists' : 'index missing'}; ${tokensaveConfigured ? '.mcp.json configured' : '.mcp.json missing'}`
        : `${tokensaveCommand} not on PATH; TokenSave index and agent hook cannot be verified`,
      tokensaveAvailable
        ? 'run `tokensave init`, `tokensave sync`, and `tokensave doctor --agent codex`'
        : 'install with `brew install aovestdipaperino/tap/tokensave` or `cargo install tokensave`, then run `karen setup token-tools`',
    ),
    check(
      'tokensave-agent-hook',
      'TokenSave agent hook',
      'optional',
      tokensaveDoctor?.status === 0 ? 'pass' : 'warn',
      tokensaveDoctor
        ? tokensaveDoctor.status === 0
          ? 'tokensave doctor --agent codex passed'
          : `tokensave doctor --agent codex exited ${tokensaveDoctor.status}`
        : 'tokensave doctor skipped because TokenSave is not available',
      'run `tokensave install --agent codex` or `karen setup token-tools`',
    ),
  ];
}

function check(
  id: string,
  label: string,
  severity: DoctorSeverity,
  status: DoctorStatus,
  message: string,
  remediation?: string,
): DoctorCheck {
  return remediation && status !== 'pass'
    ? { id, label, severity, status, message: redactSecretText(message), remediation: redactSecretText(remediation) }
    : { id, label, severity, status, message: redactSecretText(message) };
}

function resolveDoctorEnv(env: NodeJS.ProcessEnv, cwd: string): NodeJS.ProcessEnv {
  const dotenvPath = env.OPENKAREN_ENV_FILE
    ? resolve(cwd, env.OPENKAREN_ENV_FILE)
    : join(cwd, '.env');
  if (!existsSync(dotenvPath)) {
    return env;
  }
  return {
    ...env,
    ...parseDotEnvFile(dotenvPath),
  };
}

function parseDotEnvFile(path: string): NodeJS.ProcessEnv {
  const parsed: NodeJS.ProcessEnv = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const normalized = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    parsed[normalized.slice(0, separator).trim()] = unquoteDotEnvValue(
      normalized.slice(separator + 1).trim(),
    );
  }
  return parsed;
}

function unquoteDotEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const comment = value.match(/\s+#/);
  return comment ? value.slice(0, comment.index).trimEnd() : value;
}

function readPackageJson(cwd: string): DoctorEnv['packageJson'] {
  return readJsonFile(join(cwd, 'package.json')) as DoctorEnv['packageJson'];
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function optionalEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseListEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isLocalhost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function booleanEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function parseDashboardEnabled(env: NodeJS.ProcessEnv): boolean {
  const switchValue = env.OPENKAREN_DASHBOARD?.trim().toLowerCase();
  if (switchValue === 'off' || switchValue === 'false' || switchValue === '0') {
    return false;
  }
  return booleanEnv(env.OPENKAREN_DASHBOARD_ENABLED ?? 'true');
}

function missingEnabledSlackKeys(env: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];
  if (!optionalEnv(env.SLACK_BOT_TOKEN ?? env.OPENKAREN_SLACK_BOT_TOKEN)) {
    missing.push('SLACK_BOT_TOKEN');
  }
  if (!optionalEnv(env.OPENKAREN_SLACK_SIGNING_SECRET)) {
    missing.push('OPENKAREN_SLACK_SIGNING_SECRET');
  }
  return missing;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAgentMode(env: NodeJS.ProcessEnv): 'relay' | 'command' | 'queue' {
  const explicit = optionalEnv(env.OPENKAREN_AGENT_MODE);
  if (explicit === 'relay' || explicit === 'command' || explicit === 'queue') {
    return explicit;
  }
  return optionalEnv(env.OPENKAREN_AGENT_COMMAND) ? 'command' : 'relay';
}

function nodeSatisfies(version: string, requirement: string): boolean {
  const required = requirement.match(/>=\s*(\d+)/);
  if (!required) {
    return true;
  }
  return Number.parseInt(version.split('.')[0] ?? '0', 10) >= Number.parseInt(required[1], 10);
}

async function importAvailable(specifier: string): Promise<boolean> {
  try {
    await import(specifier);
    return true;
  } catch {
    return false;
  }
}

async function rickySdkAvailable(): Promise<boolean> {
  try {
    const module = await import('@agentworkforce/ricky');
    return typeof module.createRickySdk === 'function';
  } catch {
    return false;
  }
}

function mcpServerCommand(config: Record<string, unknown> | null, server: string): string | null {
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return null;
  }
  const entry = (servers as Record<string, unknown>)[server];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const command = (entry as Record<string, unknown>).command;
  return typeof command === 'string' && command.trim() ? command : null;
}

function mcpServerArgs(config: Record<string, unknown> | null, server: string): string[] {
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return [];
  }
  const entry = (servers as Record<string, unknown>)[server];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [];
  }
  const args = (entry as Record<string, unknown>).args;
  return Array.isArray(args)
    ? args.filter((arg): arg is string => typeof arg === 'string')
    : [];
}

function existsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): { status: number | null; output: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 5_000,
    env,
  });
  return {
    status: result.status,
    output: redactSecretText(`${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()),
  };
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolveListen) => {
    const server = createServer();
    server.once('error', () => {
      resolveListen(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolveListen(true);
      });
    });
    server.listen(port, host);
  });
}
