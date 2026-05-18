import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenKaren } from '../src/assistant.js';
import type { OpenKarenConfig } from '../src/types.js';

let polls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.includes('/getUpdates')) {
    polls += 1;
    return jsonResponse({ ok: true, result: [] });
  }
  return jsonResponse({ ok: true, result: {} });
}) as typeof fetch;

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-startup-resilience-'));
const runtime = createOpenKaren(testConfig(dataDir));
const running = runtime.start();

try {
  await waitFor(() => polls > 0, 2_000);
  await runtime.stop();
  await Promise.race([
    running,
    sleep(2_000).then(() => {
      throw new Error('OpenKaren did not stop cleanly after webhook startup failure');
    }),
  ]);
  console.log('startup resilience ok');
} finally {
  await runtime.stop().catch(() => {});
  globalThis.fetch = originalFetch;
  await rm(dataDir, { recursive: true, force: true });
}

function testConfig(dataDir: string): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://telegram.local',
    telegramAllowedChatIds: new Set(['123']),
    relaycastEnabled: true,
    relaycastHost: '203.0.113.1',
    relaycastPort: 7528,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir: join(dataDir, 'relayfile-mount'),
    relayfileWorkspace: 'openkaren',
    relayfileBaseUrl: null,
    relayfileToken: null,
    relaycronBaseUrl: null,
    relaycronApiKey: null,
    relaycronWebhookUrl: null,
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
    agentMode: 'queue',
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function waitFor(assertion: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await sleep(25);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
