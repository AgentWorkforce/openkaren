import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRelayRuntime,
  formatRelayResult,
  runOpenKarenTurn,
  setRelayFactoryForTesting,
  setRelayLogReaderForTesting,
  shutdownOpenKarenRelaySessions,
} from '../src/agent-runner.js';
import { statusText, type ActiveCodingTurn } from '../src/assistant.js';
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

const stagedResponse = formatRelayResult({
  agentName: 'OpenKarenCoder-test',
  waitStatus: 'idle',
  output: '[verifier]\nChanged the response formatting and verified the routing test.',
});

if (stagedResponse !== normalResponse) {
  throw new Error(`Expected staged relay output to collapse to the useful completion line, got: ${stagedResponse}`);
}

const formattedEmptySuccess = formatRelayResult({
  agentName: 'OpenKarenCoder-test',
  waitStatus: 'idle',
  output: '   ',
});

if (formattedEmptySuccess.includes('OpenKarenCoder-test') || !formattedEmptySuccess.includes('did not leave a useful completion summary')) {
  throw new Error(`Expected empty relay response to hide agent name, got: ${formattedEmptySuccess}`);
}

const formattedTimeout = formatRelayResult({
  agentName: 'OpenKarenCoder-test',
  waitStatus: 'timeout',
  output: 'Partial worker output',
  workflow: 'orchestrated',
  brokerReuse: 'reused',
});

if (
  !formattedTimeout.toLowerCase().includes('relay orchestrated timed out before i got a clean completion summary') ||
  !formattedTimeout.includes('already-running broker') ||
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

    const firstArtifact = await readLatestRunArtifact(dataDir);
    assertRunArtifactShape(firstArtifact);
    assertEqual(firstArtifact.messageId, 'telegram:1:10', 'relay artifact message id');
    assertEqual(firstArtifact.sessionKey.length, 16, 'relay artifact session key length');
    assertEqual(firstArtifact.workflowMode, 'orchestrated', 'relay artifact workflow');
    assertEqual(firstArtifact.rolesSpawned.join(','), 'planner,implementer,reviewer,verifier', 'relay artifact roles');
    assertEqual(firstArtifact.modelsOrPersonas[0], 'planner:model-architecture-planner', 'relay artifact model');
    assertEqual(firstArtifact.brokerReused, false, 'fresh broker artifact state');
    assertEqual(firstArtifact.waitStatus, 'idle', 'relay artifact wait status');
    assertRelayStatusText(config, firstArtifact);

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
    workforceRoutingProfile: join(
      process.cwd(),
      '../workforce/packages/workload-router/routing-profiles/default.json',
    ),
    nangoBaseUrl: null,
    nangoSecretKey: null,
    nangoWebhookPath: '/webhooks/nango',
    rtkCommand: 'rtk',
    tilthCommand: 'tilth',
    burnCommand: 'burn-missing-agent-runner-test',
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
    decisionModel: null,
    decisionCli: 'codex',
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
  const connectedClients: MockRelayClient[] = [];

  setRelayLogReaderForTesting(async (agentName) => ({
    found: true,
    content: `${roleFromName(agentName)} output follow-up`,
  }));

  setRelayFactoryForTesting(async () => ({
    AgentRelay: class FailingRelay extends MockRelay {
      constructor(options: Record<string, unknown>) {
        super(options);
        throw new Error('another broker instance is already running in this directory');
      }
    },
    AgentRelayClient: {
      connect: (_options: { cwd: string; connectionPath?: string }) => {
        const client = new MockRelayClient();
        connectedClients.push(client);
        return client;
      },
    },
  }));

  try {
    const config = testConfig(dataDir);
    const result = await runOpenKarenTurn(config, testTurn('telegram:2:10', 'Reconnect to relay broker'));

    if (!result.text.includes('verifier output')) {
      throw new Error(`Expected reused broker flow to succeed, got: ${result.text}`);
    }
    if (connectedClients.length !== 1) {
      throw new Error(`Expected one reused relay client, got ${connectedClients.length}`);
    }
    const artifact = await readLatestRunArtifact(dataDir);
    assertEqual(artifact.brokerReused, true, 'reused broker artifact state');
    assertEqual(artifact.waitStatus, 'idle', 'reused broker wait status');
  } finally {
    await shutdownOpenKarenRelaySessions();
    setRelayLogReaderForTesting(null);
    setRelayFactoryForTesting(null);
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function assertAsyncExistingBrokerReconnect(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-agent-runner-async-reconnect-'));
  await writePersonas(dataDir);
  const connectedClients: MockRelayClient[] = [];

  setRelayLogReaderForTesting(async (agentName) => ({
    found: true,
    content: `${roleFromName(agentName)} output follow-up`,
  }));

  setRelayFactoryForTesting(async () => ({
    AgentRelay: class AsyncFailingRelay extends MockRelay {
      constructor(options: Record<string, unknown>) {
        super(options);
      }

      override onBrokerStderr(listener: (line: string) => void): () => void {
        listener('Error: another broker instance is already running in this directory (pid: 6049)');
        throw new Error('Broker process exited with code 1 before becoming ready (stderr_tail=Error: another broker instance is already running in this directory (pid: 6049))');
      }
    },
    AgentRelayClient: {
      connect: (_options: { cwd: string; connectionPath?: string }) => {
        const client = new MockRelayClient();
        connectedClients.push(client);
        return client;
      },
    },
  }));

  try {
    const config = testConfig(dataDir);
    const result = await runOpenKarenTurn(config, testTurn('telegram:3:10', 'Reconnect after async broker startup failure'));

    if (!result.text.includes('verifier output')) {
      throw new Error(`Expected async reused broker flow to succeed, got: ${result.text}`);
    }
    if (connectedClients.length !== 1) {
      throw new Error(`Expected one async reused relay client, got ${connectedClients.length}`);
    }
    const artifact = await readLatestRunArtifact(dataDir);
    assertEqual(artifact.brokerReused, true, 'async reused broker artifact state');
    assertEqual(artifact.waitStatus, 'idle', 'async reused broker wait status');
  } finally {
    await shutdownOpenKarenRelaySessions();
    setRelayLogReaderForTesting(null);
    setRelayFactoryForTesting(null);
    await rm(dataDir, { recursive: true, force: true });
  }
}

type TestRunArtifact = {
  messageId: string;
  sessionKey: string;
  workflowMode: string;
  rolesSpawned: string[];
  modelsOrPersonas: string[];
  brokerReused: boolean;
  startedAt: string;
  completedAt: string;
  waitStatus: string;
  finalSummary: string;
};

async function readLatestRunArtifact(dataDir: string): Promise<TestRunArtifact> {
  const runsDir = join(dataDir, 'runs');
  const files = (await readdir(runsDir)).filter((file) => file.endsWith('.json')).sort();
  const latest = files.at(-1);
  if (!latest) {
    throw new Error('Expected relay run artifact');
  }

  return JSON.parse(await readFile(join(runsDir, latest), 'utf8')) as TestRunArtifact;
}

function assertRunArtifactShape(artifact: TestRunArtifact): void {
  assertEqual(
    Object.keys(artifact).sort().join(','),
    [
      'brokerReused',
      'completedAt',
      'finalSummary',
      'messageId',
      'modelsOrPersonas',
      'rolesSpawned',
      'sessionKey',
      'startedAt',
      'waitStatus',
      'workflowMode',
    ].sort().join(','),
    'relay artifact field inventory',
  );

  if (!Array.isArray(artifact.rolesSpawned) || !Array.isArray(artifact.modelsOrPersonas)) {
    throw new Error(`Expected relay artifact arrays, got ${JSON.stringify(artifact)}`);
  }

  if (!artifact.startedAt || !artifact.completedAt || !artifact.finalSummary) {
    throw new Error(`Expected relay artifact timestamps and summary, got ${JSON.stringify(artifact)}`);
  }
}

function assertRelayStatusText(config: OpenKarenConfig, artifact: TestRunArtifact): void {
  const activeTurn: ActiveCodingTurn = {
    messageId: 'telegram:1:status',
    targetId: '1',
    surfaceId: 'telegram',
    startedAt: '2026-05-20T10:00:00.000Z',
    mode: 'relay',
    lifecycleState: 'working',
    text: 'Status coverage task',
  };
  const status = statusText(config, activeTurn);

  assertIncludes(status, 'active: yes (telegram:1, 2026-05-20T10:00:00.000Z, still working)', 'active relay status');
  assertIncludes(status, 'last relay run: idle', 'last relay run status');
  assertIncludes(status, `last relay message: ${artifact.messageId}`, 'last relay message');
  assertIncludes(status, `last relay session: ${artifact.sessionKey}`, 'last relay session');
  assertIncludes(status, 'last relay workflow: orchestrated', 'last relay workflow');
  assertIncludes(status, 'last relay roles: planner, implementer, reviewer, verifier', 'last relay roles');
  assertIncludes(status, 'last relay broker: fresh', 'last relay broker');
  assertIncludes(status, 'last relay summary:', 'last relay summary');
}

function roleFromName(name: string): string {
  return name.slice(name.lastIndexOf('-') + 1);
}

function assertIncludes(text: string, expected: string, label: string): void {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${label} to include ${expected}, got: ${text}`);
  }
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

  async waitForReady(): Promise<void> {}

  async waitForIdle(): Promise<'idle'> {
    return 'idle';
  }

  async release(): Promise<void> {}
}

class MockRelayClient {
  private readonly relay = new MockRelay({ reused: true });
  private listener: ((event: Record<string, unknown>) => void) | null = null;
  private readonly existingAgents = [
    'OpenKarenCoder-telegram_1-773e8f78-planner',
    'OpenKarenCoder-telegram_1-773e8f78-implementer',
    'OpenKarenCoder-telegram_1-773e8f78-reviewer',
    'OpenKarenCoder-telegram_1-773e8f78-verifier',
  ];

  onEvent(listener: (event: Record<string, unknown>) => void): () => void {
    this.listener = listener;
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  async spawnPty(input: { name: string; task?: string; model?: string }): Promise<{ name: string }> {
    const agent = await this.relay.spawnPty(input);
    this.listener?.({ kind: 'worker_ready', name: agent.name });
    this.listener?.({ kind: 'agent_idle', name: agent.name, idle_secs: 1 });
    return { name: agent.name };
  }

  async sendMessage(input: { to: string; text: string; threadId?: string }): Promise<unknown> {
    await this.relay.human().sendMessage(input);
    this.listener?.({ kind: 'relay_inbound', from: input.to, event_id: `evt_${input.to}`, body: input.text });
    queueMicrotask(() => {
      this.listener?.({ kind: 'agent_idle', name: input.to, idle_secs: 1 });
    });
    return {};
  }

  async listAgents(): Promise<Array<{ name: string }>> {
    return this.existingAgents.map((name) => ({ name }));
  }

  async shutdown(): Promise<void> {}
}

await assertOrchestratedRelayFlow();
await assertExistingBrokerReconnect();
await assertAsyncExistingBrokerReconnect();

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
