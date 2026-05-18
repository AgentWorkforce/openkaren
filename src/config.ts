import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { OpenKarenConfig } from './types.js';

const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_RELAYCAST_HOST = '127.0.0.1';
const DEFAULT_RELAYCAST_PORT = 7528;
const DEFAULT_RELAYCAST_WEBHOOK_PATH = '/webhooks/relaycast';
const DEFAULT_RELAYFILE_MOUNT_DIR = 'relayfile-mount';
const DEFAULT_RELAYFILE_WORKSPACE = 'openkaren';
const DEFAULT_DASHBOARD_PATH = '/dashboard';
const DEFAULT_SLACK_WEBHOOK_PATH = '/webhooks/slack';
const DEFAULT_NANGO_WEBHOOK_PATH = '/webhooks/nango';
const DEFAULT_WORKFORCE_PERSONA_DIR = '../workforce/personas';
const DEFAULT_WORKFORCE_ROUTING_PROFILE = '../workforce/packages/workload-router/routing-profiles/default.json';
const DEFAULT_RELAY_CLI = 'codex';
const DEFAULT_RELAY_CHANNEL = 'openkaren-dev';
const DEFAULT_RELAY_WORKFLOW = 'orchestrated';
const DEFAULT_RELAY_IDLE_THRESHOLD_SECS = 20;
const DEFAULT_RELAY_NAME_PREFIX = 'OpenKarenCoder';
const DEFAULT_RELAY_PROGRESS_INTERVAL_MS = 2 * 60_000;
const DEFAULT_RTK_COMMAND = 'rtk';
const DEFAULT_TILTH_COMMAND = 'tilth';
const DEFAULT_BURN_COMMAND = 'burn';
const DEFAULT_WASH_COMMAND = 'wash';
const DEFAULT_TOKENSAVE_COMMAND = 'tokensave';
const DEFAULT_MONTHLY_BUDGET_USD = 75;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OpenKarenConfig {
  const resolvedEnv = resolveConfigEnv(env);
  const telegramBotToken = requireEnv(resolvedEnv, 'TELEGRAM_BOT_TOKEN');
  const agentCommand = normalizeOptional(resolvedEnv.OPENKAREN_AGENT_COMMAND);
  const agentCwd = resolve(resolvedEnv.OPENKAREN_AGENT_CWD ?? process.cwd());
  const dataDir = resolve(resolvedEnv.OPENKAREN_DATA_DIR ?? '.openkaren');
  const agentMode = parseAgentMode(resolvedEnv, agentCommand);

  mkdirSync(dataDir, { recursive: true });

  return {
    telegramBotToken,
    telegramApiBaseUrl: resolvedEnv.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org',
    telegramAllowedChatIds: parseSet(resolvedEnv.TELEGRAM_ALLOWED_CHAT_IDS),
    relaycastEnabled: parseBoolean(resolvedEnv.OPENKAREN_RELAYCAST_ENABLED),
    relaycastHost: resolvedEnv.OPENKAREN_RELAYCAST_HOST?.trim() || DEFAULT_RELAYCAST_HOST,
    relaycastPort: parsePositiveInt(
      resolvedEnv.OPENKAREN_RELAYCAST_PORT,
      DEFAULT_RELAYCAST_PORT,
      'OPENKAREN_RELAYCAST_PORT',
    ),
    relaycastWebhookPath: parseWebhookPath(resolvedEnv.OPENKAREN_RELAYCAST_WEBHOOK_PATH),
    relaycastWebhookSecret: normalizeOptional(resolvedEnv.OPENKAREN_RELAYCAST_WEBHOOK_SECRET),
    relayfileMountDir: resolve(resolvedEnv.OPENKAREN_RELAYFILE_MOUNT_DIR ?? DEFAULT_RELAYFILE_MOUNT_DIR),
    relayfileWorkspace: resolvedEnv.OPENKAREN_RELAYFILE_WORKSPACE?.trim() || DEFAULT_RELAYFILE_WORKSPACE,
    relayfileBaseUrl: normalizeOptional(resolvedEnv.OPENKAREN_RELAYFILE_BASE_URL),
    relayfileToken: normalizeOptional(resolvedEnv.RELAYFILE_TOKEN ?? resolvedEnv.OPENKAREN_RELAYFILE_TOKEN),
    relaycronBaseUrl: normalizeOptional(resolvedEnv.OPENKAREN_RELAYCRON_BASE_URL),
    relaycronApiKey: normalizeOptional(
      resolvedEnv.RELAYCRON_API_KEY ?? resolvedEnv.OPENKAREN_RELAYCRON_API_KEY,
    ),
    relaycronWebhookUrl: normalizeOptional(resolvedEnv.OPENKAREN_RELAYCRON_WEBHOOK_URL),
    dashboardEnabled: parseBoolean(resolvedEnv.OPENKAREN_DASHBOARD_ENABLED ?? 'true'),
    dashboardPath: parseWebhookPath(resolvedEnv.OPENKAREN_DASHBOARD_PATH ?? DEFAULT_DASHBOARD_PATH),
    stateWorkerUrl: normalizeOptional(resolvedEnv.OPENKAREN_STATE_WORKER_URL),
    stateWorkerAuthToken: normalizeOptional(
      resolvedEnv.OPENKAREN_STATE_AUTH_TOKEN ?? resolvedEnv.KAREN_STATE_TOKEN,
    ),
    stateUserId: resolvedEnv.OPENKAREN_STATE_USER_ID?.trim() || 'local',
    slackEnabled: parseBoolean(resolvedEnv.OPENKAREN_SLACK_ENABLED),
    slackSigningSecret: normalizeOptional(resolvedEnv.OPENKAREN_SLACK_SIGNING_SECRET),
    slackAllowedChannelIds: parseSet(resolvedEnv.OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS),
    slackBotToken: normalizeOptional(resolvedEnv.SLACK_BOT_TOKEN ?? resolvedEnv.OPENKAREN_SLACK_BOT_TOKEN),
    slackWebhookPath: parseWebhookPath(resolvedEnv.OPENKAREN_SLACK_WEBHOOK_PATH ?? DEFAULT_SLACK_WEBHOOK_PATH),
    workforcePersonaDir: resolve(
      resolvedEnv.OPENKAREN_WORKFORCE_PERSONA_DIR ?? DEFAULT_WORKFORCE_PERSONA_DIR,
    ),
    workforceRoutingProfile: resolve(
      resolvedEnv.OPENKAREN_WORKFORCE_ROUTING_PROFILE ?? DEFAULT_WORKFORCE_ROUTING_PROFILE,
    ),
    nangoBaseUrl: normalizeOptional(resolvedEnv.NANGO_BASE_URL ?? resolvedEnv.OPENKAREN_NANGO_BASE_URL),
    nangoSecretKey: normalizeOptional(
      resolvedEnv.NANGO_SECRET_KEY ?? resolvedEnv.OPENKAREN_NANGO_SECRET_KEY,
    ),
    nangoWebhookPath: parseWebhookPath(resolvedEnv.OPENKAREN_NANGO_WEBHOOK_PATH ?? DEFAULT_NANGO_WEBHOOK_PATH),
    rtkCommand: resolvedEnv.OPENKAREN_RTK_COMMAND?.trim() || DEFAULT_RTK_COMMAND,
    tilthCommand: resolvedEnv.OPENKAREN_TILTH_COMMAND?.trim() || DEFAULT_TILTH_COMMAND,
    burnCommand: resolvedEnv.OPENKAREN_BURN_COMMAND?.trim() || DEFAULT_BURN_COMMAND,
    washCommand: resolvedEnv.OPENKAREN_WASH_COMMAND?.trim() || DEFAULT_WASH_COMMAND,
    tokensaveCommand: resolvedEnv.OPENKAREN_TOKENSAVE_COMMAND?.trim() || DEFAULT_TOKENSAVE_COMMAND,
    monthlyBudgetUsd: parsePositiveNumber(
      resolvedEnv.OPENKAREN_MONTHLY_BUDGET_USD,
      DEFAULT_MONTHLY_BUDGET_USD,
      'OPENKAREN_MONTHLY_BUDGET_USD',
    ),
    agentMode,
    agentCommand,
    agentCwd,
    agentTimeoutMs: parsePositiveInt(
      resolvedEnv.OPENKAREN_AGENT_TIMEOUT_MS,
      DEFAULT_AGENT_TIMEOUT_MS,
      'OPENKAREN_AGENT_TIMEOUT_MS',
    ),
    agentRelayCli: resolvedEnv.OPENKAREN_AGENT_RELAY_CLI?.trim() || DEFAULT_RELAY_CLI,
    agentRelayModel: normalizeOptional(resolvedEnv.OPENKAREN_AGENT_RELAY_MODEL),
    agentRelayChannel: resolvedEnv.OPENKAREN_AGENT_RELAY_CHANNEL?.trim() || DEFAULT_RELAY_CHANNEL,
    agentRelayWorkflow: parseRelayWorkflow(resolvedEnv.OPENKAREN_AGENT_RELAY_WORKFLOW),
    agentRelayNamePrefix: resolvedEnv.OPENKAREN_AGENT_RELAY_NAME_PREFIX?.trim() || DEFAULT_RELAY_NAME_PREFIX,
    agentRelayIdleThresholdSecs: parsePositiveInt(
      resolvedEnv.OPENKAREN_AGENT_RELAY_IDLE_THRESHOLD_SECONDS,
      DEFAULT_RELAY_IDLE_THRESHOLD_SECS,
      'OPENKAREN_AGENT_RELAY_IDLE_THRESHOLD_SECONDS',
    ),
    agentRelayProgressIntervalMs: parsePositiveInt(
      resolvedEnv.OPENKAREN_AGENT_RELAY_PROGRESS_INTERVAL_MS,
      DEFAULT_RELAY_PROGRESS_INTERVAL_MS,
      'OPENKAREN_AGENT_RELAY_PROGRESS_INTERVAL_MS',
    ),
    dataDir,
    pollTimeoutSeconds: parsePositiveInt(
      resolvedEnv.OPENKAREN_TELEGRAM_POLL_TIMEOUT_SECONDS,
      25,
      'OPENKAREN_TELEGRAM_POLL_TIMEOUT_SECONDS',
    ),
  };
}

function resolveConfigEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dotenvPath = env.OPENKAREN_ENV_FILE
    ? resolve(env.OPENKAREN_ENV_FILE)
    : env === process.env
      ? resolve('.env')
      : null;
  if (!dotenvPath || !existsSync(dotenvPath)) {
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

    const key = normalized.slice(0, separator).trim();
    const rawValue = normalized.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    parsed[key] = unquoteDotEnvValue(rawValue);
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

function parseWebhookPath(value: string | undefined): string {
  const path = value?.trim() || DEFAULT_RELAYCAST_WEBHOOK_PATH;
  if (!path.startsWith('/')) {
    throw new Error('OPENKAREN_RELAYCAST_WEBHOOK_PATH must start with /');
  }
  return path;
}

function parseRelayWorkflow(value: string | undefined): OpenKarenConfig['agentRelayWorkflow'] {
  const workflow = normalizeOptional(value) ?? DEFAULT_RELAY_WORKFLOW;
  if (workflow === 'single' || workflow === 'orchestrated') {
    return workflow;
  }

  throw new Error('OPENKAREN_AGENT_RELAY_WORKFLOW must be single or orchestrated');
}

function parseAgentMode(
  env: NodeJS.ProcessEnv,
  agentCommand: string | null,
): OpenKarenConfig['agentMode'] {
  const explicitMode = normalizeOptional(env.OPENKAREN_AGENT_MODE);
  if (explicitMode) {
    if (explicitMode === 'relay' || explicitMode === 'command' || explicitMode === 'queue') {
      if (explicitMode === 'command' && !agentCommand) {
        throw new Error('OPENKAREN_AGENT_MODE=command requires OPENKAREN_AGENT_COMMAND');
      }
      return explicitMode;
    }

    throw new Error('OPENKAREN_AGENT_MODE must be relay, command, or queue');
  }

  if (parseBoolean(env.OPENKAREN_AGENT_RELAY_ENABLED)) {
    return 'relay';
  }

  return agentCommand ? 'command' : 'relay';
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = normalizeOptional(env[name]);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return parsed;
}
