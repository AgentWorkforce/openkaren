import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelaycastWebhookServer } from '../src/relaycast.js';
import type { RelayCronProgressTurn } from '../src/relaycron.js';
import { InMemoryKarenStateClient } from '../src/state.js';
import type { OpenKarenConfig, RelaycastWebhookPayload } from '../src/types.js';

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-relaycron-webhook-'));
const port = 7528;
let received: RelayCronProgressTurn | null = null;
let proactiveName: string | null = null;
let inboxText: string | null = null;
let slackText: string | null = null;
let nangoConnectionId: string | null = null;
const state = new InMemoryKarenStateClient({ monthlyBudgetUsd: 75 });
const fakeTelegramToken = `123456789:${'ABCDEFGHIJKLMNOPQRSTUVWXYZabc_def'}`;
const fakeOpenAiKey = `sk-proj-${'abcdefghijklmnopqrstuvwxyz1234567890'}`;

const server = new RelaycastWebhookServer(
  testConfig(dataDir, port),
  () => {
    throw new Error('Relaycast handler should not receive RelayCron payloads');
  },
  (turn) => {
    received = turn;
  },
  (turn) => {
    proactiveName = turn.scheduleName;
  },
  (event) => {
    inboxText = event.text;
  },
  (payload) => {
    slackText = slackEventText(payload);
  },
  (event) => {
    nangoConnectionId = event.connection.connectionId;
    void state.upsertNangoConnection(event.connection);
  },
  () => ({
    messageId: 'm1',
    surfaceId: 'telegram',
    targetId: fakeTelegramToken,
    startedAt: '2026-05-20T10:00:00.000Z',
    lifecycleState: 'working',
    text: `use ${fakeOpenAiKey}`,
  }),
);
const secureSlackServer = new RelaycastWebhookServer(
  {
    ...testConfig(dataDir, port + 1),
    slackSigningSecret: 'secret',
  },
  () => {
    throw new Error('Relaycast handler should not receive secure Slack payloads');
  },
  undefined,
  undefined,
  undefined,
  () => {
    throw new Error('Slack signature failure should not reach handler');
  },
);

try {
  const response = await server.dispatchForTesting({
    method: 'POST',
    path: '/webhooks/relaycron',
    body: {
      payload: {
        type: 'openkaren.progress_check',
        messageId: 'telegram:1:2',
        targetId: '123',
        surfaceId: 'telegram',
        startedAt: '2026-05-16T00:00:00.000Z',
        mode: 'relay',
        text: 'keep wiring',
      },
    },
  });

  if (response.statusCode !== 202) {
    throw new Error(`Expected RelayCron webhook 202, got ${response.statusCode}`);
  }

  if (!received || received.messageId !== 'telegram:1:2' || received.targetId !== '123') {
    throw new Error(`Expected normalized RelayCron progress turn, got ${JSON.stringify(received)}`);
  }

  const proactive = await server.dispatchForTesting({
    method: 'POST',
    path: '/webhooks/relaycron',
    body: {
      payload: {
        type: 'openkaren.proactive_tick',
        scheduleName: 'workflow-health-check',
        targetId: '123',
        surfaceId: 'telegram',
      },
    },
  });

  if (proactive.statusCode !== 202 || proactiveName !== 'workflow-health-check') {
    throw new Error(
      `Expected proactive RelayCron webhook, got status ${proactive.statusCode} name ${proactiveName}`,
    );
  }

  const inbox = await server.dispatchForTesting({
    method: 'POST',
    path: '/webhooks/inbox',
    body: {
      source: 'n8n',
      title: 'Calendar prep brief',
    },
  });

  if (inbox.statusCode !== 202 || inboxText !== 'Calendar prep brief') {
    throw new Error(`Expected inbox webhook, got status ${inbox.statusCode} text ${inboxText}`);
  }

  const slack = await server.dispatchForTesting({
    method: 'POST',
    path: '/webhooks/slack',
    body: {
      type: 'event_callback',
      team_id: 'T1',
      event: {
        type: 'message',
        user: 'U1',
        text: 'review this build',
        channel: 'C1',
        ts: '1710000000.000100',
      },
    },
  });

  if (slack.statusCode !== 202 || slackText !== 'review this build') {
    throw new Error(`Expected Slack webhook, got status ${slack.statusCode} text ${slackText}`);
  }

  const slackChallenge = await server.dispatchForTesting({
    method: 'POST',
    path: '/webhooks/slack',
    body: {
      type: 'url_verification',
      challenge: 'launch-ready',
    },
  });

  if (slackChallenge.statusCode !== 200 || slackChallenge.body.challenge !== 'launch-ready') {
    throw new Error(`Expected Slack URL verification challenge, got ${JSON.stringify(slackChallenge)}`);
  }

  const secureBody = JSON.stringify({
    type: 'event_callback',
    team_id: 'T1',
    event: {
      type: 'message',
      user: 'U1',
      text: 'signed message',
      channel: 'C1',
      ts: '1710000000.000100',
    },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const validButWrongBodySignature = `v0=${createHmac('sha256', 'secret')
    .update(`v0:${timestamp}:${secureBody}-tampered`)
    .digest('hex')}`;
  const signatureFailure = await secureSlackServer.dispatchForTesting({
    method: 'POST',
    path: '/webhooks/slack',
    headers: {
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': validButWrongBodySignature,
    },
    body: secureBody,
  });

  if (signatureFailure.statusCode !== 401 || signatureFailure.body.ignored !== 'invalid-signature') {
    throw new Error(`Expected Slack signature failure, got ${JSON.stringify(signatureFailure)}`);
  }

  const nango = await server.dispatchForTesting({
    method: 'POST',
    path: '/webhooks/nango',
    body: {
      type: 'connection.updated',
      connection: {
        integration_id: 'slack',
        connection_id: 'conn-slack',
        provider_config_key: 'slack',
      },
    },
  });

  if (nango.statusCode !== 202 || nangoConnectionId !== 'conn-slack') {
    throw new Error(
      `Expected Nango webhook, got status ${nango.statusCode} connection ${nangoConnectionId}`,
    );
  }
  const storedNangoConnection = await state.getNangoConnection('slack');
  if (
    storedNangoConnection?.connectionId !== 'conn-slack' ||
    storedNangoConnection.providerConfigKey !== 'slack'
  ) {
    throw new Error(`Expected /webhooks/nango to persist state, got ${JSON.stringify(storedNangoConnection)}`);
  }

  const dashboard = await server.dispatchForTesting({
    method: 'GET',
    path: '/dashboard',
  });

  if (
    dashboard.statusCode !== 200 ||
    typeof dashboard.body.raw !== 'string' ||
    !dashboard.body.raw.includes('OpenKaren Token Dashboard')
  ) {
    throw new Error(`Expected dashboard HTML, got ${dashboard.statusCode}`);
  }

  const dashboardData = await server.dispatchForTesting({
    method: 'GET',
    path: `/dashboard/data?user=${fakeOpenAiKey}`,
  });

  if (dashboardData.statusCode !== 200 || dashboardData.body.userId !== '[REDACTED]') {
    throw new Error(`Expected dashboard data, got ${dashboardData.statusCode}`);
  }
  const dashboardJson = JSON.stringify(dashboardData.body);
  if (
    dashboardJson.includes(fakeOpenAiKey) ||
    dashboardJson.includes(fakeTelegramToken)
  ) {
    throw new Error(`Expected dashboard data to redact secrets, got ${dashboardJson}`);
  }
  if (
    !dashboardData.body.spend ||
    (dashboardData.body.spend as { available?: unknown }).available !== false ||
    (dashboardData.body.spend as { spendUsd?: unknown }).spendUsd !== null
  ) {
    throw new Error(`Expected unavailable scoped dashboard spend, got ${JSON.stringify(dashboardData.body.spend)}`);
  }
  const tagScope = dashboardData.body.tagScope as Record<string, unknown> | undefined;
  if (tagScope?.app !== 'openkaren' || tagScope.persona !== 'karen' || tagScope.tenant !== 'local') {
    throw new Error(`Expected OpenKaren dashboard tag scope, got ${JSON.stringify(tagScope)}`);
  }
  const tools = dashboardData.body.tools as Array<{ id?: string; state?: string }> | undefined;
  if (!tools?.some((tool) => tool.id === 'burn' && tool.state === 'missing')) {
    throw new Error(`Expected dashboard token tool readiness, got ${JSON.stringify(tools)}`);
  }

  const wrongPath = await server.dispatchForTesting({
    method: 'POST',
    path: '/webhooks/relaycast',
    body: { text: 'ignored' },
  });

  if (wrongPath.statusCode !== 404) {
    throw new Error(`Expected disabled Relaycast path to 404, got ${wrongPath.statusCode}`);
  }

  console.log('relaycron webhook ok');
} finally {
  await server.stop().catch(() => {});
  await secureSlackServer.stop().catch(() => {});
  await rm(dataDir, { recursive: true, force: true });
}

function testConfig(dataDir: string, port: number): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['123']),
    relaycastEnabled: false,
    relaycastHost: '127.0.0.1',
    relaycastPort: port,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir: join(process.cwd(), 'relayfile-mount'),
    relayfileWorkspace: 'openkaren',
    relayfileBaseUrl: null,
    relayfileToken: null,
    relaycronBaseUrl: 'http://127.0.0.1:4007',
    relaycronApiKey: 'rc_test',
    relaycronWebhookUrl: `http://127.0.0.1:${port}/webhooks/relaycron`,
    dashboardEnabled: true,
    dashboardPath: '/dashboard',
    stateWorkerUrl: null,
    stateWorkerAuthToken: null,
    stateUserId: 'local',
    slackEnabled: true,
    slackSigningSecret: null,
    slackAllowedChannelIds: new Set(['C1']),
    slackBotToken: null,
    slackWebhookPath: '/webhooks/slack',
    workforcePersonaDir: join(process.cwd(), '../workforce/personas'),
    workforceRoutingProfile: join(
      process.cwd(),
      '../workforce/packages/workload-router/routing-profiles/default.json',
    ),
    nangoBaseUrl: null,
    nangoSecretKey: null,
    nangoWebhookPath: '/webhooks/nango',
    rtkCommand: 'rtk',
    tilthCommand: 'tilth',
    burnCommand: 'burn-missing-for-dashboard-test',
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

function slackEventText(payload: RelaycastWebhookPayload): string | null {
  const event = (payload as { event?: { text?: unknown } }).event;
  return typeof event?.text === 'string' ? event.text : null;
}
