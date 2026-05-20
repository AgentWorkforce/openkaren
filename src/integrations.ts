import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { automationMeshHealth, DEFAULT_N8N_ROUTES } from './automation-mesh.js';
import { relayfilePromptContext } from './relayfile.js';
import { isRickySdkAvailable } from './ricky.js';
import { tokenToolsPrompt, tokenToolStatuses } from './token-tools.js';
import type { OpenKarenConfig } from './types.js';

export type IntegrationState = 'wired' | 'configured' | 'available' | 'missing';

export type IntegrationStatus = {
  id: string;
  label: string;
  state: IntegrationState;
  detail: string;
};

const RELAYFILE_WATCHED_PROVIDERS = ['github', 'linear', 'notion', 'slack'];

export function integrationStatuses(config: OpenKarenConfig): IntegrationStatus[] {
  const meshHealth = automationMeshHealth(DEFAULT_N8N_ROUTES);
  return [
    {
      id: 'agent-assistant',
      label: 'agent-assistant',
      state: 'wired',
      detail: '@agent-assistant/sdk owns runtime, traits, sessions, and surfaces',
    },
    {
      id: 'relay',
      label: 'agent-relay',
      state: config.agentMode === 'relay' ? 'wired' : 'available',
      detail: config.agentMode === 'relay'
        ? `${config.agentRelayWorkflow} workflow via ${config.agentRelayCli}`
        : `inactive; mode=${config.agentMode}`,
    },
    {
      id: 'relayfile',
      label: 'relayfile',
      state: existsDir(config.relayfileMountDir)
        ? 'wired'
        : config.relayfileBaseUrl && config.relayfileToken
          ? 'configured'
          : 'missing',
      detail: relayfileStatusDetail(config),
    },
    {
      id: 'automation-mesh',
      label: 'automation-mesh',
      state: meshHealth.state === 'missing' ? 'missing' : 'configured',
      detail: [
        `routes=${meshHealth.routeCount}`,
        `state=${meshHealth.state}`,
        `watched routes=${meshHealth.routes.join(', ') || 'none'}`,
        meshHealth.routeCount === 0
          ? 'action: add n8n routes before forwarding relaycast findings'
          : 'action: verify the listed n8n webhook URLs are reachable; route misses and last POST errors are logged by deliverRelaycastFindingToN8n',
      ].join('; '),
    },
    {
      id: 'relaycast',
      label: 'relaycast',
      state: config.relaycastEnabled ? 'wired' : 'configured',
      detail: config.relaycastEnabled
        ? `webhook ${config.relaycastHost}:${config.relaycastPort}${config.relaycastWebhookPath}`
        : 'webhook disabled',
    },
    {
      id: 'relaycron',
      label: 'relaycron',
      state: config.relaycronBaseUrl && config.relaycronApiKey && config.relaycronWebhookUrl
        ? 'wired'
        : config.relaycronBaseUrl && config.relaycronApiKey
          ? 'configured'
          : 'missing',
      detail: config.relaycronBaseUrl && config.relaycronApiKey && config.relaycronWebhookUrl
        ? `progress checks every 2 minutes via ${config.relaycronBaseUrl}`
        : config.relaycronBaseUrl
          ? 'scheduler configured; set OPENKAREN_RELAYCRON_WEBHOOK_URL for progress callbacks'
          : 'set OPENKAREN_RELAYCRON_BASE_URL, RELAYCRON_API_KEY, and OPENKAREN_RELAYCRON_WEBHOOK_URL',
    },
    {
      id: 'durable-state',
      label: 'durable-state',
      state: config.stateWorkerUrl ? 'wired' : 'configured',
      detail: config.stateWorkerUrl
        ? `KarenUserDO proxy ${config.stateWorkerUrl} for user ${config.stateUserId}; auth ${config.stateWorkerAuthToken ? 'bearer token set' : 'missing local bearer token'}`
        : 'local in-memory state adapter active; set OPENKAREN_STATE_WORKER_URL for KarenUserDO',
    },
    {
      id: 'slack',
      label: 'slack',
      state: config.slackEnabled ? 'wired' : config.nangoBaseUrl ? 'configured' : 'missing',
      detail: config.slackEnabled
        ? `Slack webhook ${config.slackWebhookPath}; thread replies enabled`
        : config.nangoBaseUrl
          ? 'Slack OAuth can be sourced from Nango; enable OPENKAREN_SLACK_ENABLED'
          : 'set Nango Slack OAuth and OPENKAREN_SLACK_ENABLED for Slack surface',
    },
    {
      id: 'ricky',
      label: 'ricky',
      state: isRickySdkAvailable() ? 'wired' : 'missing',
      detail: isRickySdkAvailable()
        ? `@agentworkforce/ricky SDK wired with default cwd ${config.agentCwd}`
        : '@agentworkforce/ricky SDK unavailable',
    },
    {
      id: 'workforce',
      label: 'workforce',
      state: existsDir(config.workforcePersonaDir) ? 'wired' : 'missing',
      detail: existsDir(config.workforcePersonaDir)
        ? `personas ${config.workforcePersonaDir}`
        : `persona dir missing: ${config.workforcePersonaDir}`,
    },
    {
      id: 'nango',
      label: 'nango',
      state: config.nangoBaseUrl && config.nangoSecretKey ? 'configured' : 'missing',
      detail: config.nangoBaseUrl
        ? `OAuth provider config present; connection refresh webhook at ${config.nangoWebhookPath}`
        : `optional OAuth backing for relayfile providers not configured; connection refresh webhook path ${config.nangoWebhookPath}`,
    },
    {
      id: 'inbox',
      label: 'inbox',
      state: config.relaycastEnabled ? 'wired' : 'configured',
      detail: config.relaycastEnabled
        ? `external integration webhook at ${config.relaycastHost}:${config.relaycastPort}/webhooks/inbox`
        : 'enable OPENKAREN_RELAYCAST_ENABLED for n8n/Pipedream/Composio webhook ingress',
    },
    {
      id: 'n8n',
      label: 'n8n',
      state: config.relaycastEnabled ? 'configured' : 'missing',
      detail: config.relaycastEnabled
        ? 'post n8n webhook nodes to /webhooks/inbox with source=n8n'
        : 'self-host n8n on port 5678 and point webhooks at Karen inbox',
    },
    {
      id: 'pipedream',
      label: 'pipedream',
      state: config.relaycastEnabled ? 'configured' : 'missing',
      detail: config.relaycastEnabled
        ? 'Pipedream can POST events to Karen inbox webhook'
        : 'requires public tunnel or hosted webhook delivery',
    },
    {
      id: 'composio',
      label: 'composio',
      state: config.relaycastEnabled ? 'configured' : 'missing',
      detail: config.relaycastEnabled
        ? 'Composio events can enter through Karen inbox webhook'
        : 'requires hosted Composio account and webhook delivery',
    },
    ...tokenToolStatuses(config).map((tool) => ({
      id: tool.id,
      label: tool.id,
      state: tool.state,
      detail: tool.detail,
    })),
  ];
}

export function integrationStatusText(config: OpenKarenConfig): string {
  return integrationStatuses(config)
    .map((integration) => `${integration.label}: ${integration.state}; ${integration.detail}`)
    .join('\n');
}

export function integrationPrompt(config: OpenKarenConfig): string {
  const statuses = integrationStatuses(config);
  const lines = [
    'Dependency wiring:',
    ...statuses.map((item) => `- ${item.label}: ${item.state}; ${item.detail}`),
    '',
    'Use wired/configured dependencies when useful:',
    `- relay: coding execution is ${config.agentMode === 'relay' ? 'active' : 'not active'}; do not bypass it from inside the worker.`,
    `- relayfile: if ${config.relayfileMountDir} exists, inspect integration data there as normal files.`,
    relayfilePromptContext(config),
    `- relaycast: use it as the backstage transcript/channel layer when available.`,
    `- relaycron: relay turns register a 2-minute progress schedule when base URL, API key, and webhook URL are configured; otherwise local progress updates are used.`,
    `- durable-state: ${config.stateWorkerUrl ? `KarenUserDO is authoritative for sessions, budget, memory, Nango, and workflows; local client auth is ${config.stateWorkerAuthToken ? 'configured' : 'missing'}` : 'local memory adapter is active until OPENKAREN_STATE_WORKER_URL is configured'}.`,
    `- slack: ${config.slackEnabled ? 'Slack surface is active; reply in-thread and bridge sessions by user identity' : 'Slack surface is inactive; Nango-backed OAuth config can enable it'}.`,
    '- inbox: n8n, Pipedream, and Composio events can POST JSON to /webhooks/inbox when the local webhook listener is exposed.',
    `- nango: Nango connection refresh payloads POST JSON to ${config.nangoWebhookPath}; keep OAuth provider secrets configured through Nango.`,
    '- ricky: use Karen\'s createOpenKarenRicky(config) SDK adapter for workflow generation/runs when needed; do not shell out to a ricky CLI from worker prompts.',
    `- workforce: prefer personas from ${config.workforcePersonaDir} when selecting specialist roles.`,
    tokenToolsPrompt(config),
  ];

  return lines.join('\n');
}

function existsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function relayfileStatusDetail(config: OpenKarenConfig): string {
  const mounted = existsDir(config.relayfileMountDir);
  const apiState = config.relayfileBaseUrl && config.relayfileToken
    ? `API configured for workspace ${config.relayfileWorkspace}`
    : 'API credentials missing; set OPENKAREN_RELAYFILE_BASE_URL and RELAYFILE_TOKEN or mount relayfile locally';
  const recentEvents = mounted ? recentRelayfileEvents(config.relayfileMountDir) : [];
  return [
    `path=${config.relayfileMountDir}`,
    `state=${mounted ? 'exists' : 'missing'}`,
    apiState,
    `watched providers=${RELAYFILE_WATCHED_PROVIDERS.join(', ')} plus mounted workspace files`,
    `recent events=${recentEvents.join(', ') || 'none observed'}`,
    mounted ? 'action: inspect files under the relayfile mount for provider updates' : 'action: create/mount relayfile path or configure the relayfile API',
  ].join('; ');
}

function recentRelayfileEvents(mountDir: string, limit = 3): string[] {
  return walkRelayfileFiles(mountDir)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit)
    .map((event) => `${event.relativePath} (${new Date(event.mtimeMs).toISOString()})`);
}

function walkRelayfileFiles(root: string, relativeRoot = ''): Array<{ relativePath: string; mtimeMs: number }> {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(join(root, relativeRoot), { withFileTypes: true });
  } catch {
    return [];
  }

  const files: Array<{ relativePath: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name.endsWith('~')) {
      continue;
    }
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '.git') {
        continue;
      }
      files.push(...walkRelayfileFiles(root, relativePath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    try {
      files.push({ relativePath, mtimeMs: statSync(join(root, relativePath)).mtimeMs });
    } catch {
      // The relayfile mount can change while being inspected.
    }
  }
  return files;
}
