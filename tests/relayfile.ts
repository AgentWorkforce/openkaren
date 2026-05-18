import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RelayfileWatcher,
  relayfileEventText,
  relativeRelayfilePath,
  type RelayfileWatchEvent,
} from '../src/relayfile.js';
import type { OpenKarenConfig } from '../src/types.js';

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-relayfile-'));
const mountDir = join(dataDir, 'relayfile-mount');
await mkdir(join(mountDir, 'github', 'repos', 'openkaren', 'pulls'), { recursive: true });

const events: RelayfileWatchEvent[] = [];
const watcher = new RelayfileWatcher(testConfig(dataDir, mountDir), (event) => {
  events.push(event);
});

try {
  watcher.start();
  await writeFile(
    join(mountDir, 'github', 'repos', 'openkaren', 'pulls', '1.json'),
    JSON.stringify({ title: 'Wire relayfile' }),
  );
  await waitFor(() => events.some((event) => event.relativePath.includes('pulls/1.json')), 3_000);

  const event = events.find((item) => item.relativePath.includes('pulls/1.json')) as RelayfileWatchEvent;
  if (event.provider !== 'github' || !event.relativePath.includes('pulls/1.json')) {
    throw new Error(`Unexpected relayfile event: ${JSON.stringify(event)}`);
  }

  const text = relayfileEventText(event);
  if (!text.includes('Relayfile moved: github/')) {
    throw new Error(`Unexpected relayfile text: ${text}`);
  }

  const relativePath = relativeRelayfilePath(
    testConfig(dataDir, mountDir),
    join(mountDir, 'linear', 'issues', '2.json'),
  );
  if (relativePath !== 'linear/issues/2.json') {
    throw new Error(`Unexpected relative relayfile path: ${relativePath}`);
  }

  console.log('relayfile ok');
} finally {
  watcher.stop();
  await rm(dataDir, { recursive: true, force: true });
}

function testConfig(dataDir: string, mountDir: string): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['123']),
    relaycastEnabled: false,
    relaycastHost: '127.0.0.1',
    relaycastPort: 3789,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir: mountDir,
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

async function waitFor(assertion: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for relayfile event');
}
