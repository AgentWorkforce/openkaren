import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startRelayCronProgress,
  startRelayCronProactiveSchedules,
} from '../src/relaycron.js';
import type { OpenKarenConfig } from '../src/types.js';

const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const parsedUrl = new URL(url);
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
  requests.push({ method: init?.method ?? 'GET', url: parsedUrl.pathname, body });

  if (parsedUrl.pathname === '/v1/schedules') {
    return jsonResponse(200, { ok: true, data: { id: 'sched_progress' } });
  }

  if (parsedUrl.pathname === '/v1/schedules/sched_progress/cancel') {
    return jsonResponse(200, { ok: true });
  }

  return jsonResponse(404, { error: 'not_found' });
};

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-relaycron-'));

try {
  const config = testConfig(dataDir, 'https://relaycron.example');
  const handle = await startRelayCronProgress(config, {
    messageId: 'telegram:1:2',
    targetId: '123',
    surfaceId: 'telegram',
    startedAt: '2026-05-16T00:00:00.000Z',
    mode: 'relay',
    text: 'fix yourself',
  });

  if (!handle.enabled || handle.scheduleId !== 'sched_progress') {
    throw new Error(`Expected enabled RelayCron handle, got ${JSON.stringify(handle)}`);
  }

  await handle.stop();

  const proactive = await startRelayCronProactiveSchedules(config, {
    surfaceId: 'telegram',
    targetId: '123',
  });

  if (!proactive.enabled) {
    throw new Error('Expected proactive RelayCron schedules to be enabled');
  }

  await proactive.stop();

  const create = requests.find((request) => request.url === '/v1/schedules');
  if (!create) {
    throw new Error('Expected schedule create request');
  }

  if (create.body.cron_expression !== '*/2 * * * *') {
    throw new Error(`Expected two-minute cron, got ${String(create.body.cron_expression)}`);
  }

  const transport = create.body.transport as { url?: string } | undefined;
  if (transport?.url !== 'https://openkaren.example/webhooks/relaycron') {
    throw new Error(`Expected webhook transport URL, got ${transport?.url}`);
  }

  if (!requests.some((request) => request.url === '/v1/schedules/sched_progress/cancel')) {
    throw new Error('Expected schedule cancel request');
  }

  const proactiveCreates = requests.filter((request) => {
    const name = request.body.name;
    return typeof name === 'string' && !name.startsWith('openkaren-progress-');
  });

  if (proactiveCreates.length !== 3) {
    throw new Error(`Expected three proactive schedules, got ${proactiveCreates.length}`);
  }

  const proactiveNames = proactiveCreates.map((request) => request.body.name).sort().join(',');
  if (
    proactiveNames !==
    'openkaren-daily-standup,openkaren-weekly-spend-review,openkaren-workflow-health-check'
  ) {
    throw new Error(`Unexpected proactive schedule names: ${proactiveNames}`);
  }

  console.log('relaycron ok');
} finally {
  globalThis.fetch = originalFetch;
  await rm(dataDir, { recursive: true, force: true });
}

function testConfig(dataDir: string, relaycronBaseUrl: string): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['123']),
    relaycastEnabled: false,
    relaycastHost: '127.0.0.1',
    relaycastPort: 3789,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir: join(process.cwd(), 'relayfile-mount'),
    relayfileWorkspace: 'openkaren',
    relayfileBaseUrl: null,
    relayfileToken: null,
    relaycronBaseUrl,
    relaycronApiKey: 'ac_test',
    relaycronWebhookUrl: 'https://openkaren.example/webhooks/relaycron',
    workforcePersonaDir: join(process.cwd(), '../workforce/personas'),
    workforceRoutingProfile: join(
      process.cwd(),
      '../workforce/packages/workload-router/routing-profiles/default.json',
    ),
    nangoBaseUrl: null,
    nangoSecretKey: null,
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
