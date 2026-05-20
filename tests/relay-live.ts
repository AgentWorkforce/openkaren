import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLastRelayRun } from '../src/relay-evidence.js';
import { runOpenKarenTurn, shutdownOpenKarenRelaySessions } from '../src/agent-runner.js';
import type { OpenKarenConfig } from '../src/types.js';

if (process.env.OPENKAREN_LIVE_RELAY_TEST !== '1') {
  console.log('relay live test skipped; set OPENKAREN_LIVE_RELAY_TEST=1 to run it');
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), 'openkaren-relay-live-'));
const repoDir = join(root, 'repo');
const dataDir = join(root, 'data');

try {
  await mkdir(repoDir, { recursive: true });
  await mkdir(join(dataDir, 'personas'), { recursive: true });
  await writeFile(join(repoDir, 'README.md'), 'OpenKaren live relay smoke repository.\n');
  await writeWorkerPersona(dataDir);

  const config = liveConfig(dataDir, repoDir);
  const result = await runOpenKarenTurn(config, {
    chatId: 'live-relay',
    text: 'Inspect README.md and reply with a concise summary. Do not edit files.',
    message: {
      id: `relay-live:${Date.now()}`,
      surfaceId: 'telegram',
      sessionId: `relay-live:${Date.now()}`,
      userId: 'live-relay',
      workspaceId: 'live-relay',
      text: 'Inspect README.md and reply with a concise summary. Do not edit files.',
      raw: {},
      receivedAt: new Date().toISOString(),
      capability: 'chat',
    },
  });

  if (result.timedOut || result.exitCode !== 0 || !result.text.trim()) {
    throw new Error(`Expected live relay turn to complete, got ${JSON.stringify(result)}`);
  }

  const artifact = readLastRelayRun(config);
  if (!artifact || artifact.waitStatus !== 'idle' || artifact.rolesSpawned.join(',') !== 'worker') {
    throw new Error(`Expected live relay evidence artifact, got ${JSON.stringify(artifact)}`);
  }

  console.log('relay live test ok');
} finally {
  await shutdownOpenKarenRelaySessions();
  await rm(root, { recursive: true, force: true });
}

function liveConfig(dataDir: string, agentCwd: string): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['live-relay']),
    relaycastEnabled: false,
    relaycastHost: '127.0.0.1',
    relaycastPort: 0,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir: join(dataDir, 'relayfile-mount'),
    relayfileWorkspace: 'openkaren',
    relayfileBaseUrl: null,
    relayfileToken: null,
    relaycronBaseUrl: null,
    relaycronApiKey: null,
    relaycronWebhookUrl: null,
    dashboardEnabled: false,
    dashboardPath: '/dashboard',
    stateWorkerUrl: null,
    stateWorkerAuthToken: null,
    stateUserId: 'local',
    identityBridgeMappings: new Map(),
    slackEnabled: false,
    slackSigningSecret: null,
    slackAllowedChannelIds: new Set(),
    slackBotToken: null,
    slackWebhookPath: '/webhooks/slack',
    workforcePersonaDir: join(dataDir, 'personas'),
    workforceRoutingProfile: join(dataDir, 'routing-profile.json'),
    nangoBaseUrl: null,
    nangoSecretKey: null,
    nangoWebhookPath: '/webhooks/nango',
    rtkCommand: 'rtk',
    tilthCommand: 'tilth',
    burnCommand: 'true',
    washCommand: 'wash',
    tokensaveCommand: 'tokensave',
    monthlyBudgetUsd: 75,
    agentMode: 'relay',
    agentCommand: null,
    agentCwd,
    agentTimeoutMs: Number(process.env.OPENKAREN_LIVE_RELAY_TIMEOUT_MS ?? 120_000),
    agentRelayCli: process.env.OPENKAREN_AGENT_RELAY_CLI?.trim() || 'codex',
    agentRelayModel: process.env.OPENKAREN_AGENT_RELAY_MODEL?.trim() || null,
    agentRelayChannel: `openkaren-live-${process.pid}`,
    agentRelayWorkflow: 'single',
    agentRelayNamePrefix: 'OpenKarenLive',
    agentRelayIdleThresholdSecs: 5,
    agentRelayProgressIntervalMs: 120_000,
    questionRouterModel: null,
    questionRouterCli: 'codex',
    dataDir,
    pollTimeoutSeconds: 1,
  };
}

async function writeWorkerPersona(dataDir: string): Promise<void> {
  await writeFile(
    join(dataDir, 'personas', 'debugger.json'),
    JSON.stringify({
      id: 'debugger',
      intent: 'live relay smoke test',
      tiers: {
        'best-value': {
          harness: 'codex',
          model: process.env.OPENKAREN_AGENT_RELAY_MODEL?.trim() || undefined,
          systemPrompt: 'Handle the task directly and keep the reply concise.',
        },
      },
    }),
  );
}
