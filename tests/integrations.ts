import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integrationPrompt, integrationStatuses, integrationStatusText } from '../src/integrations.js';
import type { OpenKarenConfig } from '../src/types.js';

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-integrations-'));
const relayfileMount = join(dataDir, 'relayfile-mount');

try {
  await mkdir(join(relayfileMount, 'github'), { recursive: true });
  await writeFile(join(relayfileMount, 'github', 'pull-42.json'), JSON.stringify({ title: 'Fix auth' }));
  const config = testConfig(dataDir, relayfileMount);
  const statuses = integrationStatuses(config);

  for (const id of [
    'agent-assistant',
    'relay',
    'relayfile',
    'automation-mesh',
    'relaycast',
    'relaycron',
    'durable-state',
    'slack',
    'ricky',
    'workforce',
    'nango',
    'inbox',
    'n8n',
    'pipedream',
    'composio',
    'rtk',
    'tilth',
    'burn',
    'wash',
    'tokensave',
  ]) {
    if (!statuses.some((status) => status.id === id)) {
      throw new Error(`Missing integration status for ${id}`);
    }
  }

  const statusText = integrationStatusText(config);
  if (!statusText.includes('relayfile: wired')) {
    throw new Error('Expected relayfile wired status');
  }
  if (
    !statusText.includes('path=') ||
    !statusText.includes('watched providers=github, linear, notion, slack') ||
    !statusText.includes('recent events=github/pull-42.json')
  ) {
    throw new Error(`Expected relayfile path, watched providers, and recent events: ${statusText}`);
  }
  if (
    !statusText.includes('automation-mesh: configured') ||
    !statusText.includes('route misses and last POST errors are logged')
  ) {
    throw new Error(`Expected actionable automation mesh health in integrations: ${statusText}`);
  }
  if (!statusText.includes('ricky: wired')) {
    throw new Error('Expected ricky SDK wired status');
  }
  if (!statusText.includes(`nango: configured; OAuth provider config present; connection refresh webhook at ${config.nangoWebhookPath}`)) {
    throw new Error(`Expected Nango status to expose the configured webhook path: ${statusText}`);
  }
  if (!statusText.includes('durable-state: wired; KarenUserDO proxy https://state.example for user operator-1; auth bearer token set')) {
    throw new Error(`Expected durable-state status to expose worker auth posture: ${statusText}`);
  }

  const prompt = integrationPrompt(config);
  if (!prompt.includes('relaycron') || !prompt.includes('tokensave') || !prompt.includes('/webhooks/inbox')) {
    throw new Error(`Expected integration prompt to mention scheduler, inbox, and token graph: ${prompt}`);
  }
  if (!prompt.includes(`Nango connection refresh payloads POST JSON to ${config.nangoWebhookPath}`)) {
    throw new Error(`Expected integration prompt to route Nango refreshes to ${config.nangoWebhookPath}: ${prompt}`);
  }
  if (prompt.includes('Nango-style events can POST JSON to /webhooks/inbox')) {
    throw new Error(`Expected integration prompt not to route Nango refreshes through inbox: ${prompt}`);
  }
  if (!prompt.includes('Token tool policy:') || !prompt.includes('RTK') || !prompt.includes('Tilth')) {
    throw new Error(`Expected integration prompt to include token tool policy: ${prompt}`);
  }
  if (!prompt.includes('createOpenKarenRicky(config)') || prompt.includes('use ricky for workflow')) {
    throw new Error(`Expected integration prompt to point workers at the Ricky SDK adapter: ${prompt}`);
  }

  console.log('integrations ok');
} finally {
  await rm(dataDir, { recursive: true, force: true });
}

function testConfig(dataDir: string, relayfileMountDir: string): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['1']),
    relaycastEnabled: true,
    relaycastHost: '127.0.0.1',
    relaycastPort: 3789,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir,
    relayfileWorkspace: 'openkaren',
    relayfileBaseUrl: 'http://127.0.0.1:9090',
    relayfileToken: 'test',
    relaycronBaseUrl: 'http://127.0.0.1:4007',
    relaycronApiKey: 'ac_test',
    relaycronWebhookUrl: 'http://127.0.0.1/webhooks/relaycron',
    workforcePersonaDir: join(process.cwd(), '../workforce/personas'),
    workforceRoutingProfile: join(
      process.cwd(),
      '../workforce/packages/workload-router/routing-profiles/default.json',
    ),
    nangoBaseUrl: 'http://127.0.0.1:3003',
    nangoSecretKey: 'secret',
    nangoWebhookPath: '/webhooks/nango',
    stateWorkerUrl: 'https://state.example',
    stateWorkerAuthToken: 'token-123',
    stateUserId: 'operator-1',
    rtkCommand: 'rtk',
    tilthCommand: 'tilth',
    burnCommand: 'burn',
    washCommand: 'wash',
    tokensaveCommand: 'tokensave',
    monthlyBudgetUsd: 75,
    agentMode: 'relay',
    agentCommand: null,
    agentCwd: process.cwd(),
    agentTimeoutMs: 5_000,
    agentRelayCli: 'codex',
    agentRelayModel: null,
    agentRelayChannel: 'openkaren-dev',
    agentRelayWorkflow: 'orchestrated',
    agentRelayNamePrefix: 'OpenKarenCoder',
    agentRelayIdleThresholdSecs: 1,
    agentRelayProgressIntervalMs: 120_000,
    dataDir,
    pollTimeoutSeconds: 1,
  };
}
