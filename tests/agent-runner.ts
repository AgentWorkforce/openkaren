import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRelayRuntime,
  formatRelayResult,
  runOpenKarenTurn,
  setRelayFactoryForTesting,
  shutdownOpenKarenRelaySessions,
} from '../src/agent-runner.js';
import type { OpenKarenConfig } from '../src/types.js';

const normalResponse = 'Changed the response formatting and verified the routing test.';
const formattedSuccess = formatRelayResult({
  agentName: 'OpenKarenCoder-test',
  waitStatus: 'idle',
  output: normalResponse,
});

if (formattedSuccess !== normalResponse) {
  throw new Error(`Expected successful relay output to pass through, got: ${formattedSuccess}`);
}

const formattedEmptySuccess = formatRelayResult({
  agentName: 'OpenKarenCoder-test',
  waitStatus: 'idle',
  output: '   ',
});

if (formattedEmptySuccess.includes('OpenKarenCoder-test')) {
  throw new Error(`Expected empty relay response to hide agent name, got: ${formattedEmptySuccess}`);
}

const formattedTimeout = formatRelayResult({
  agentName: 'OpenKarenCoder-test',
  waitStatus: 'timeout',
  output: 'Partial worker output',
});

if (
  !formattedTimeout.toLowerCase().includes('timed out') ||
  formattedTimeout.includes('OpenKarenCoder-test')
) {
  throw new Error(`Expected timeout response without relay agent name, got: ${formattedTimeout}`);
}

const verboseOutput = Array.from({ length: 400 }, (_, index) => `line ${index}`).join('\n');
const compacted = formatRelayResult({
  agentName: 'OpenKarenCoder-test',
  waitStatus: 'idle',
  output: verboseOutput,
});

if (compacted.length > 1_600 || !compacted.startsWith('...')) {
  throw new Error(`Expected compact relay output, got ${compacted.length} chars`);
}

const relayRuntime = buildRelayRuntime(
  { agentRelayChannel: 'openkaren-dev' },
  {
    RELAY_API_KEY: 'br_invalid',
    RELAY_WORKSPACES_JSON: JSON.stringify([{ workspace_id: 'rw_bad', api_key: 'br_bad' }]),
  } as NodeJS.ProcessEnv,
);

if (
  relayRuntime.workspaceId !== 'ws_openkarendev' ||
  relayRuntime.env.RELAY_API_KEY ||
  relayRuntime.env.RELAY_WORKSPACES_JSON ||
  relayRuntime.skipRelayPrompt
) {
  throw new Error(`Expected valid local relay runtime, got ${JSON.stringify(relayRuntime)}`);
}

async function assertOrchestratedRelayFlow(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-agent-runner-'));
  await writePersonas(dataDir);
  const relays: MockRelay[] = [];

  setRelayFactoryForTesting(async () => ({
    AgentRelay: class extends MockRelay {
      constructor(options: Record<string, unknown>) {
        super(options);
        relays.push(this);
      }
    },
  }));

  try {
    const config = testConfig(dataDir);
    const first = await runOpenKarenTurn(config, testTurn('telegram:1:10', 'First task'));
    const relay = relays[0];

    if (!relay) {
      throw new Error('Expected relay session to be created');
    }

    assertEqual(
      relay.spawns.map((spawn) => roleFromName(spawn.name)).join(','),
      'planner,implementer,reviewer,verifier',
      'orchestrated relay roles',
    );
    assertEqual(relay.spawns[0]?.model, 'model-architecture-planner', 'planner persona model');

    if (!relay.spawns[0]?.task?.includes('Workforce persona:')) {
      throw new Error('Expected workforce persona context in planner prompt');
    }

    if (!first.text.includes('verifier output')) {
      throw new Error(`Expected verifier output from orchestrated relay, got: ${first.text}`);
    }

    const second = await runOpenKarenTurn(config, testTurn('telegram:1:11', 'Follow up'));

    assertEqual(relays.length, 1, 'relay session count');
    assertEqual(relay.spawns.length, 4, 'relay spawn count after follow-up');
    assertEqual(relay.sentMessages.length, 4, 'follow-up handoff count');

    if (!second.text.includes('verifier output')) {
      throw new Error(`Expected verifier output on follow-up, got: ${second.text}`);
    }
  } finally {
    await shutdownOpenKarenRelaySessions();
    setRelayFactoryForTesting(null);
    await rm(dataDir, { recursive: true, force: true });
  }
}

function testConfig(dataDir: string): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['1']),
    relaycastEnabled: false,
    relaycastHost: '127.0.0.1',
    relaycastPort: 3789,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir: join(process.cwd(), 'relayfile-mount'),
    relayfileWorkspace: 'openkaren',
    relayfileBaseUrl: null,
    relayfileToken: null,
    relaycronBaseUrl: null,
    relaycronApiKey: null,
    relaycronWebhookUrl: null,
    workforcePersonaDir: join(dataDir, 'personas'),
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

function testTurn(id: string, text: string) {
  return {
    chatId: '1',
    text,
    message: {
      id,
      surfaceId: 'telegram',
      sessionId: 'telegram:1',
      userId: '1',
      workspaceId: 'telegram:1',
      text,
      raw: {},
      receivedAt: '2026-05-16T00:00:00.000Z',
      capability: 'chat',
    },
  };
}

async function assertExistingBrokerReconnect(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-agent-runner-reconnect-'));
  await writePersonas(dataDir);
  const connectedRelays: MockRelay[] = [];

  setRelayFactoryForTesting(async () => ({
    AgentRelay: class FailingRelay extends MockRelay {
      constructor(options: Record<string, unknown>) {
        super(options);
        throw new Error('another broker instance is already running in this directory');
      }
    },
    AgentRelayClient: {
      connect: (_options: { cwd: string }) => {
        const relay = new MockRelay({ reused: true });
        connectedRelays.push(relay);
        return relay;
      },
    },
  }));

  try {
    const config = testConfig(dataDir);
    const result = await runOpenKarenTurn(config, testTurn('telegram:2:10', 'Reconnect to relay broker'));

    if (!result.text.includes('verifier output')) {
      throw new Error(`Expected reused broker flow to succeed, got: ${result.text}`);
    }
    if (connectedRelays.length !== 1) {
      throw new Error(`Expected one reused relay client, got ${connectedRelays.length}`);
    }
  } finally {
    await shutdownOpenKarenRelaySessions();
    setRelayFactoryForTesting(null);
    await rm(dataDir, { recursive: true, force: true });
  }
}

function roleFromName(name: string): string {
  return name.slice(name.lastIndexOf('-') + 1);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${label} ${String(expected)}, got ${String(actual)}`);
  }
}

class MockRelay {
  onWorkerOutput: ((event: { name?: string; chunk: string }) => void) | null = null;
  readonly spawns: Array<{ name: string; task?: string; model?: string }> = [];
  readonly sentMessages: Array<{ to: string; text: string; threadId?: string }> = [];
  private readonly logs = new Map<string, string>();

  constructor(readonly options: Record<string, unknown>) {}

  async spawnPty(input: { name: string; task?: string; model?: string }): Promise<MockAgent> {
    this.spawns.push({ name: input.name, task: input.task, model: input.model });
    const role = roleFromName(input.name);
    this.logs.set(input.name, `${role} output`);
    return new MockAgent(input.name);
  }

  human(): { sendMessage: (input: { to: string; text: string; threadId?: string }) => Promise<void> } {
    return {
      sendMessage: async (input) => {
        this.sentMessages.push(input);
        const role = roleFromName(input.to);
        const previous = this.logs.get(input.to) ?? '';
        this.logs.set(input.to, `${previous}\n${role} output follow-up`);
      },
    };
  }

  async getLogs(agentName: string): Promise<{ found: boolean; content?: string }> {
    return {
      found: this.logs.has(agentName),
      content: this.logs.get(agentName),
    };
  }

  onBrokerStderr(): () => void {
    return () => {};
  }

  async shutdown(): Promise<void> {}
}

class MockAgent {
  constructor(readonly name: string) {}

  async waitForIdle(): Promise<'idle'> {
    return 'idle';
  }

  async release(): Promise<void> {}
}

await assertOrchestratedRelayFlow();
await assertExistingBrokerReconnect();

console.log('agent runner ok');

async function writePersonas(dataDir: string): Promise<void> {
  const personaDir = join(dataDir, 'personas');
  await mkdir(personaDir, { recursive: true });
  await Promise.all(
    ['architecture-planner', 'debugger', 'code-reviewer', 'verifier'].map(async (id) => {
      await writeFile(
        join(personaDir, `${id}.json`),
        JSON.stringify({
          id,
          intent: id,
          description: `${id} test persona`,
          tiers: {
            'best-value': {
              harness: 'codex',
              model: `model-${id}`,
              systemPrompt: `${id} prompt`,
            },
          },
        }),
      );
    }),
  );
}
