import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { integrationPrompt } from './integrations.js';
import { createKarenStateClient } from './state.js';
import { stampBurnSession } from './token-consciousness.js';
import { workforceModelForRole, workforcePromptForRole } from './workforce.js';
import type {
  AgentRunResult,
  ConversationMessage,
  ConversationRole,
  OpenKarenConfig,
  OpenKarenTurn,
} from './types.js';

const MAX_AGENT_OUTPUT_CHARS = 12_000;
const MAX_TELEGRAM_RESULT_CHARS = 1_500;
const MAX_CONVERSATION_MESSAGES = 24;
const MAX_CONVERSATION_TEXT_CHARS = 4_000;

type RelayWaitStatus = 'idle' | 'timeout' | 'exited';
type RelayAgentRole = 'worker' | 'planner' | 'implementer' | 'reviewer' | 'verifier';

const ORCHESTRATED_RELAY_ROLES = [
  'planner',
  'implementer',
  'reviewer',
  'verifier',
] as const satisfies readonly RelayAgentRole[];

type RelayAgentHandle = {
  name: string;
  waitForIdle(timeoutMs?: number): Promise<RelayWaitStatus>;
  release(options?: string | { reason?: string }): Promise<void>;
};

type RelayHumanHandle = {
  sendMessage(input: {
    to: string;
    text: string;
    threadId?: string;
    priority?: number;
    data?: Record<string, unknown>;
  }): Promise<unknown>;
};

type RelayHandle = {
  onWorkerOutput: ((event: { name?: string; chunk: string }) => void) | null;
  onBrokerStderr?: (listener: (line: string) => void) => () => void;
  spawnPty(input: {
    name: string;
    cli: string;
    task?: string;
    channels?: string[];
    cwd?: string;
    idleThresholdSecs?: number;
    model?: string;
    skipRelayPrompt?: boolean;
  }): Promise<RelayAgentHandle>;
  human(options: { name: string }): RelayHumanHandle;
  getLogs(
    agentName: string,
    options?: { lines?: number },
  ): Promise<{ found: boolean; content?: string }>;
  shutdown(): Promise<void>;
};

type RelayConstructor = new (options: Record<string, unknown>) => RelayHandle;

type RelayClientFactory = {
  connect(options: { cwd: string }): unknown;
};

type RelaySession = {
  key: string;
  relay: RelayHandle;
  agents: RelaySessionAgent[];
  brokerStderr: string;
  unscopedWorkerOutput: string;
};

type RelaySessionAgent = {
  role: RelayAgentRole;
  agent: RelayAgentHandle;
  agentName: string;
  workerOutput: string;
  lastLogText: string;
  turns: number;
};

let relayFactory: () => Promise<{ AgentRelay: RelayConstructor; AgentRelayClient?: RelayClientFactory }> = async () =>
  import('@agent-relay/sdk') as Promise<{ AgentRelay: RelayConstructor; AgentRelayClient?: RelayClientFactory }>;

const relaySessions = new Map<string, Promise<RelaySession>>();
const relayTurnLocks = new Map<string, Promise<void>>();

export async function runOpenKarenTurn(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
): Promise<AgentRunResult> {
  await stampBurnSession(config, turn);
  const conversation = await recordConversationMessage(config, turn, {
    role: 'user',
    text: turn.text,
    messageId: turn.message.id,
    createdAt: turn.message.receivedAt,
  });
  const contextualTurn = { ...turn, conversation };
  let result: AgentRunResult;

  if (config.agentMode === 'relay') {
    result = await runRelay(config, contextualTurn);
  } else if (config.agentMode === 'command') {
    result = await runCommand(config, contextualTurn);
  } else {
    result = await queueTurn(config, contextualTurn);
  }

  await recordConversationMessage(config, turn, {
    role: 'assistant',
    text: result.text,
    messageId: `${turn.message.id}:assistant`,
    createdAt: new Date().toISOString(),
  });

  return result;
}

async function queueTurn(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
): Promise<AgentRunResult> {
  const inboxDir = join(config.dataDir, 'inbox');
  await mkdir(inboxDir, { recursive: true });

  const safeId = turn.message.id.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const queuedPath = join(inboxDir, `${Date.now()}-${safeId}.json`);

  await writeFile(
    queuedPath,
    JSON.stringify(
      {
        queuedAt: new Date().toISOString(),
        chatId: turn.chatId,
        text: turn.text,
        conversation: turn.conversation ?? [],
        message: turn.message,
      },
      null,
      2,
    ),
  );

  return {
    text: [
      'Queued.',
      queuedPath,
    ].join('\n'),
    exitCode: 0,
    timedOut: false,
    queuedPath,
  };
}

async function runCommand(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
): Promise<AgentRunResult> {
  return new Promise((resolve) => {
    const child = spawn(config.agentCommand as string, {
      cwd: config.agentCwd,
      env: {
        ...process.env,
        OPENKAREN_CHAT_ID: turn.chatId,
        OPENKAREN_MESSAGE_ID: turn.message.id,
        OPENKAREN_SESSION_ID: turn.message.sessionId ?? '',
        OPENKAREN_SURFACE_ID: turn.message.surfaceId,
      },
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5_000).unref();
    }, config.agentTimeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        text: `OpenKaren could not start ${basename(config.agentCommand as string)}: ${error.message}`,
        exitCode: null,
        timedOut,
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      const text = formatCommandResult({ stdout, stderr, exitCode, timedOut });
      resolve({ text, exitCode, timedOut });
    });

    child.stdin.end(buildAgentPrompt(config, turn));
  });
}

async function runRelay(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
): Promise<AgentRunResult> {
  const sessionKey = relaySessionKey(config, turn);
  const previousTurn = relayTurnLocks.get(sessionKey) ?? Promise.resolve();
  let releaseTurnLock = () => {};

  const currentTurn = new Promise<void>((resolve) => {
    releaseTurnLock = resolve;
  });
  const queuedTurn = previousTurn.catch(() => {}).then(() => currentTurn);
  relayTurnLocks.set(sessionKey, queuedTurn);

  try {
    await previousTurn.catch(() => {});
    return await runRelayTurn(config, turn, sessionKey);
  } finally {
    releaseTurnLock();
    if (relayTurnLocks.get(sessionKey) === queuedTurn) {
      relayTurnLocks.delete(sessionKey);
    }
  }
}

async function runRelayTurn(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  sessionKey: string,
): Promise<AgentRunResult> {
  try {
    const session = await getRelaySession(config, turn, sessionKey);

    if (config.agentRelayWorkflow === 'single') {
      return await runSingleRelayTurn(config, turn, session);
    }

    return await runOrchestratedRelayTurn(config, turn, session);
  } catch (error) {
    console.error('OpenKaren relay turn failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    relaySessions.delete(sessionKey);

    return {
      text: `OpenKaren could not run ${config.agentRelayCli} through agent-relay: ${
        error instanceof Error ? error.message : String(error)
      }`,
      exitCode: null,
      timedOut: false,
    };
  }
}

async function runSingleRelayTurn(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  session: RelaySession,
): Promise<AgentRunResult> {
  const member = await ensureRelayAgent(config, turn, session, 'worker', buildAgentPrompt(config, turn));
  member.workerOutput = '';

  if (member.turns > 0) {
    await sendRelayTurn(session, member, buildFollowupPrompt(config, turn));
  }

  const result = await waitForRelayMember(config, session, member);
  if (result.waitStatus === 'timeout') {
    await member.agent.release({ reason: 'OpenKaren relay turn timed out' }).catch(() => {});
    relaySessions.delete(session.key);
  }

  return {
    text: formatRelayResult({
      agentName: member.agent.name,
      waitStatus: result.waitStatus,
      output: result.output,
    }),
    exitCode: result.waitStatus === 'timeout' ? null : 0,
    timedOut: result.waitStatus === 'timeout',
  };
}

async function runOrchestratedRelayTurn(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  session: RelaySession,
): Promise<AgentRunResult> {
  const outputs: string[] = [];
  let handoff = '';

  for (const role of ORCHESTRATED_RELAY_ROLES) {
    const prompt = buildOrchestratedPrompt(config, role, turn, handoff);
    const member = await ensureRelayAgent(config, turn, session, role, prompt);
    member.workerOutput = '';

    if (member.turns > 0) {
      await sendRelayTurn(session, member, prompt);
    }

    const result = await waitForRelayMember(config, session, member);
    const roleOutput = result.output || `${role} finished without relay output.`;
    outputs.push(`[${role}]\n${roleOutput}`);
    handoff = outputs.join('\n\n');

    if (result.waitStatus === 'timeout') {
      await member.agent.release({ reason: `OpenKaren ${role} relay turn timed out` }).catch(() => {});
      relaySessions.delete(session.key);
      return {
        text: formatRelayResult({
          agentName: member.agent.name,
          waitStatus: result.waitStatus,
          output: roleOutput,
        }),
        exitCode: null,
        timedOut: true,
      };
    }
  }

  return {
    text: formatRelayResult({
      agentName: relayWorkflowName(config, turn, 'verifier'),
      waitStatus: 'idle',
      output: outputs[outputs.length - 1] ?? handoff,
    }),
    exitCode: 0,
    timedOut: false,
  };
}

async function ensureRelayAgent(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  session: RelaySession,
  role: RelayAgentRole,
  task: string,
): Promise<RelaySessionAgent> {
  const existing = session.agents.find((agent) => agent.role === role);
  if (existing) {
    return existing;
  }

  const agentName = relayWorkflowName(config, turn, role);
  const relayRuntime = buildRelayRuntime(config, process.env);
  const agent = await session.relay.spawnPty(
    {
      name: agentName,
      cli: config.agentRelayCli,
      task,
      channels: [config.agentRelayChannel],
      cwd: config.agentCwd,
      idleThresholdSecs: config.agentRelayIdleThresholdSecs,
      model: config.agentRelayModel ??
        workforceModelForRole(config, role, turn.spendSnapshot) ??
        undefined,
      skipRelayPrompt: relayRuntime.skipRelayPrompt,
    },
  );
  const member: RelaySessionAgent = {
    role,
    agent,
    agentName,
    workerOutput: '',
    lastLogText: '',
    turns: 0,
  };
  session.agents.push(member);

  console.info('OpenKaren relay agent spawned', {
    role,
    requestedName: agentName,
    agentName: agent.name,
    timeoutMs: config.agentTimeoutMs,
  });

  return member;
}

async function sendRelayTurn(
  session: RelaySession,
  member: RelaySessionAgent,
  text: string,
): Promise<void> {
  await session.relay.human({ name: 'OpenKaren Telegram' }).sendMessage({
    to: member.agent.name,
    text,
    threadId: session.key,
    data: { role: member.role },
  });
}

async function waitForRelayMember(
  config: OpenKarenConfig,
  session: RelaySession,
  member: RelaySessionAgent,
): Promise<{ waitStatus: RelayWaitStatus; output: string }> {
  const waitStatus = await member.agent.waitForIdle(config.agentTimeoutMs);
  member.turns += 1;
  console.info('OpenKaren relay agent wait finished', {
    agentName: member.agent.name,
    role: member.role,
    sessionKey: session.key,
    waitStatus,
  });

  const logText = await readRelayLogs(session.relay, member.agent.name);
  const logDelta = logTextDelta(member.lastLogText, logText);
  if (logText) {
    member.lastLogText = logText;
  }

  return {
    waitStatus,
    output: logDelta || member.workerOutput || session.unscopedWorkerOutput,
  };
}

async function getRelaySession(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  sessionKey: string,
): Promise<RelaySession> {
  const existing = relaySessions.get(sessionKey);
  if (existing) {
    return existing;
  }

  const created = createRelaySession(config, turn, sessionKey).catch((error) => {
    relaySessions.delete(sessionKey);
    throw error;
  });
  relaySessions.set(sessionKey, created);
  return created;
}

async function createRelaySession(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  sessionKey: string,
): Promise<RelaySession> {
  let relay: RelayHandle | null = null;

  try {
    const { AgentRelay, AgentRelayClient } = await relayFactory();
    const relayStateDir = join(config.dataDir, 'relay');
    const relayRuntime = buildRelayRuntime(config, process.env);
    const session: RelaySession = {
      key: sessionKey,
      relay: null as unknown as RelayHandle,
      agents: [],
      brokerStderr: '',
      unscopedWorkerOutput: '',
    };

    console.info('OpenKaren relay session starting', {
      workflow: config.agentRelayWorkflow,
      cli: config.agentRelayCli,
      cwd: config.agentCwd,
      channel: config.agentRelayChannel,
      workspaceId: relayRuntime.workspaceId,
      localRelayCredentials: relayRuntime.usingLocalCredentials,
    });

    try {
      relay = new AgentRelay({
        cwd: config.agentCwd,
        channels: [config.agentRelayChannel],
        env: relayRuntime.env,
        workspaceId: relayRuntime.workspaceId,
        workspaceName: 'OpenKaren development relay',
        binaryArgs: {
          persist: true,
          stateDir: relayStateDir,
        },
      }) as RelayHandle;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('another broker instance is already running in this directory') || !AgentRelayClient) {
        throw error;
      }

      console.warn('OpenKaren reusing existing relay broker', {
        cwd: config.agentCwd,
        stateDir: relayStateDir,
      });
      relay = AgentRelayClient.connect({ cwd: config.agentCwd }) as RelayHandle;
    }

    session.relay = relay;

    relay.onWorkerOutput = ({ name, chunk }: { name?: string; chunk: string }) => {
      const target = name
        ? session.agents.find((member) => member.agent.name === name || member.agentName === name)
        : null;
      if (target) {
        target.workerOutput = appendBounded(target.workerOutput, chunk);
      } else {
        session.unscopedWorkerOutput = appendBounded(session.unscopedWorkerOutput, chunk);
      }
    };

    relay.onBrokerStderr?.((line) => {
      session.brokerStderr = appendBounded(session.brokerStderr, `${line}\n`);
    });

    return session;
  } catch (error) {
    await relay?.shutdown().catch(() => {});
    throw error;
  }
}

export function buildRelayRuntime(
  config: Pick<OpenKarenConfig, 'agentRelayChannel'>,
  env: NodeJS.ProcessEnv = process.env,
): {
  env: NodeJS.ProcessEnv;
  workspaceId: string;
  skipRelayPrompt: boolean;
  usingLocalCredentials: boolean;
} {
  const workspaceId = relayWorkspaceId(config.agentRelayChannel);
  const relayApiKey = normalizeRelayWorkspaceKey(env.RELAY_API_KEY);
  const relayWorkspacesJson = normalizeRelayWorkspacesJson(env.RELAY_WORKSPACES_JSON);
  const relayEnv: NodeJS.ProcessEnv = {
    ...env,
    RELAY_DEFAULT_WORKSPACE: normalizeEnvValue(env.RELAY_DEFAULT_WORKSPACE) ?? workspaceId,
    RELAY_WORKSPACE_ID: normalizeEnvValue(env.RELAY_WORKSPACE_ID) ?? workspaceId,
  };

  if (relayApiKey) {
    relayEnv.RELAY_API_KEY = relayApiKey;
  } else {
    delete relayEnv.RELAY_API_KEY;
  }

  if (relayWorkspacesJson) {
    relayEnv.RELAY_WORKSPACES_JSON = relayWorkspacesJson;
  } else {
    delete relayEnv.RELAY_WORKSPACES_JSON;
  }

  return {
    env: relayEnv,
    workspaceId,
    skipRelayPrompt: false,
    usingLocalCredentials: false,
  };
}

export function buildAgentPrompt(config: OpenKarenConfig, turn: OpenKarenTurn): string {
  return [
    'You are OpenKaren developing the OpenKaren repository.',
    'Your job is to change this repository when the request implies a code, docs, config, or test change.',
    'Do not merely discuss the work. Edit files directly, then verify with the smallest relevant command.',
    'Use the existing project docs and codebase. Keep changes focused.',
    integrationPrompt(config),
    workforcePromptForRole(config, 'worker', turn.spendSnapshot),
    'Personality: genuinely funny, sarcastic, and sometimes biting, but do not let the jokes outrun the engineering.',
    'Response style: say more by saying less. Short, high-signal, no ceremony.',
    'Final Telegram reply: max 500 characters. Say what changed and what passed. If blocked, say the blocker.',
    '',
    `Telegram chat: ${turn.chatId}`,
    `Message id: ${turn.message.id}`,
    conversationContext(turn.conversation ?? []),
    '',
    turn.text,
    '',
  ].filter((line) => line !== null).join('\n');
}

export function buildFollowupPrompt(config: OpenKarenConfig, turn: OpenKarenTurn): string {
  return [
    'New Telegram turn in the same OpenKaren conversation.',
    'Continue from the existing repository and conversation state.',
    integrationPrompt(config),
    workforcePromptForRole(config, 'worker', turn.spendSnapshot),
    '',
    `Telegram chat: ${turn.chatId}`,
    `Message id: ${turn.message.id}`,
    conversationContext(turn.conversation ?? []),
    '',
    turn.text,
    '',
  ].filter((line) => line !== null).join('\n');
}

export function buildOrchestratedPrompt(
  config: OpenKarenConfig,
  role: RelayAgentRole,
  turn: OpenKarenTurn,
  handoff: string,
): string {
  const roleInstruction = {
    planner: [
      'Role: planner.',
      'Inspect the request and repository context. Produce a concise implementation plan for the next agent.',
      'Do not edit files.',
    ],
    implementer: [
      'Role: implementer.',
      'Use the planner handoff, edit the repository directly, and run the smallest relevant verification command.',
      'Report changed files and verification results.',
    ],
    reviewer: [
      'Role: reviewer.',
      'Review the implementer handoff and current repository state for bugs, regressions, and missing tests.',
      'Make focused fixes only when needed, then report findings and verification.',
    ],
    verifier: [
      'Role: verifier.',
      'Run the smallest relevant final checks and write the final Telegram reply.',
      'Keep the final reply under 500 characters. Say what changed and what passed. If blocked, say the blocker.',
    ],
    worker: [
      'Role: worker.',
      'Handle the request directly.',
    ],
  } satisfies Record<RelayAgentRole, string[]>;

  return [
    ...roleInstruction[role],
    '',
    'You are one member of an OpenKaren relay workflow. Work with the handoff; do not restart the task from scratch.',
    integrationPrompt(config),
    workforcePromptForRole(config, role, turn.spendSnapshot),
    conversationContext(turn.conversation ?? []),
    handoff ? ['', 'Workflow handoff so far:', handoff].join('\n') : null,
    '',
    `Telegram chat: ${turn.chatId}`,
    `Message id: ${turn.message.id}`,
    '',
    'Original user request:',
    turn.text,
    '',
  ].filter((line) => line !== null).join('\n');
}

export function relaySessionKey(
  config: Pick<OpenKarenConfig, 'agentCwd' | 'agentRelayChannel' | 'agentRelayWorkflow'>,
  turn: OpenKarenTurn,
): string {
  const sessionId = turn.message.sessionId ?? `telegram:${turn.chatId}`;
  return createHash('sha256')
    .update(`${config.agentCwd}\n${config.agentRelayChannel}\n${config.agentRelayWorkflow}\n${sessionId}`)
    .digest('hex')
    .slice(0, 16);
}

export async function shutdownOpenKarenRelaySessions(): Promise<void> {
  const sessions = await Promise.allSettled([...relaySessions.values()]);
  relaySessions.clear();
  relayTurnLocks.clear();

  await Promise.all(
    sessions.map(async (result) => {
      if (result.status === 'fulfilled') {
        await result.value.relay.shutdown().catch(() => {});
      }
    }),
  );
}

export function setRelayFactoryForTesting(
  factory: (() => Promise<{ AgentRelay: RelayConstructor; AgentRelayClient?: RelayClientFactory }>) | null,
): void {
  relayFactory = factory ?? (async () =>
    import('@agent-relay/sdk') as Promise<{ AgentRelay: RelayConstructor; AgentRelayClient?: RelayClientFactory }>);
}

async function readRelayLogs(
  relay: Pick<RelayHandle, 'getLogs'>,
  agentName: string,
): Promise<string> {
  const logs = await relay.getLogs(agentName, { lines: 240 }).catch(() => null);
  return logs?.found && logs.content ? appendBounded('', logs.content) : '';
}

function relayAgentName(config: OpenKarenConfig, turn: OpenKarenTurn): string {
  const sessionId = turn.message.sessionId ?? `telegram:${turn.chatId}`;
  const safeId = sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 40) || 'session';
  const digest = relaySessionKey(config, turn).slice(0, 8);
  return `${config.agentRelayNamePrefix}-${safeId}-${digest}`;
}

function relayWorkflowName(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  role: RelayAgentRole,
): string {
  const baseName = relayAgentName(config, turn);
  return role === 'worker' ? baseName : `${baseName}-${role}`;
}

async function recordConversationMessage(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  message: ConversationMessage,
): Promise<ConversationMessage[]> {
  const previous = await readConversation(config, turn);
  await appendConversationMessage(config, turn, message);
  await appendStateMessage(config, turn, message);
  return previous.slice(-MAX_CONVERSATION_MESSAGES);
}

async function appendStateMessage(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  message: ConversationMessage,
): Promise<void> {
  if (!config.stateWorkerUrl) {
    return;
  }
  await createKarenStateClient(config).appendMessage({
    sessionId: turn.message.sessionId ?? `bridge:user:${turn.message.userId}`,
    role: message.role,
    content: message.text,
    messageId: message.messageId,
  }).catch((error: unknown) => {
    console.warn('OpenKaren state message append failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function readConversation(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
): Promise<ConversationMessage[]> {
  const path = conversationPath(config, turn);
  const body = await readFile(path, 'utf8').catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  });

  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => parseConversationLine(line))
    .filter((message): message is ConversationMessage => message !== null)
    .slice(-MAX_CONVERSATION_MESSAGES);
}

async function appendConversationMessage(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  message: ConversationMessage,
): Promise<void> {
  const conversationsDir = join(config.dataDir, 'conversations');
  await mkdir(conversationsDir, { recursive: true });
  await appendFile(
    conversationPath(config, turn),
    `${JSON.stringify({
      ...message,
      text: trimConversationText(message.text),
    })}\n`,
  );
}

function conversationPath(config: OpenKarenConfig, turn: OpenKarenTurn): string {
  const sessionId = turn.message.sessionId ?? `telegram:${turn.chatId}`;
  const digest = createHash('sha256').update(sessionId).digest('hex').slice(0, 24);
  return join(config.dataDir, 'conversations', `${digest}.jsonl`);
}

function parseConversationLine(line: string): ConversationMessage | null {
  const parsed = JSON.parse(line) as Partial<ConversationMessage>;
  if (
    (parsed.role !== 'user' && parsed.role !== 'assistant') ||
    typeof parsed.messageId !== 'string' ||
    typeof parsed.text !== 'string' ||
    typeof parsed.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    role: parsed.role,
    messageId: parsed.messageId,
    text: trimConversationText(parsed.text),
    createdAt: parsed.createdAt,
  };
}

function conversationContext(messages: ConversationMessage[]): string | null {
  const recent = messages.slice(-MAX_CONVERSATION_MESSAGES);
  if (recent.length === 0) {
    return null;
  }

  return [
    '',
    'Recent conversation context:',
    ...recent.map((message) => {
      const label = message.role === 'user' ? 'User' : 'OpenKaren';
      return `${label} (${message.messageId}): ${trimConversationText(message.text)}`;
    }),
  ].join('\n');
}

function trimConversationText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CONVERSATION_TEXT_CHARS) {
    return trimmed;
  }

  return `...${trimmed.slice(trimmed.length - MAX_CONVERSATION_TEXT_CHARS)}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function relayWorkspaceId(channel: string): string {
  const suffix = channel.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 24);
  return `ws_${suffix || 'openkaren'}`;
}

function normalizeRelayWorkspaceKey(value: string | undefined): string | null {
  const key = normalizeEnvValue(value);
  return key?.startsWith('rk_') ? key : null;
}

function normalizeRelayWorkspacesJson(value: string | undefined): string | null {
  const text = normalizeEnvValue(value);
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const valid = parsed.every((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return false;
      }
      const record = entry as Record<string, unknown>;
      return (
        typeof record.workspace_id === 'string' &&
        record.workspace_id.startsWith('ws_') &&
        typeof record.api_key === 'string' &&
        record.api_key.startsWith('rk_')
      );
    });

    return valid ? text : null;
  } catch {
    return null;
  }
}

function normalizeEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function appendBounded(current: string, chunk: string): string {
  const next = current + chunk;
  if (next.length <= MAX_AGENT_OUTPUT_CHARS) {
    return next;
  }

  return next.slice(next.length - MAX_AGENT_OUTPUT_CHARS);
}

function logTextDelta(previous: string, next: string): string {
  if (!next) {
    return '';
  }

  if (!previous) {
    return next;
  }

  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }

  return next;
}

function formatCommandResult(input: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}): string {
  const output = input.stdout.trim() || input.stderr.trim();
  const status = input.timedOut
    ? 'Timed out.'
    : input.exitCode && input.exitCode !== 0
      ? `Exit ${input.exitCode}.`
      : '';

  return compactTelegramText(
    [status, output || 'Finished without output.'].filter(Boolean).join('\n\n'),
  );
}

export function formatRelayResult(input: {
  agentName: string;
  waitStatus: RelayWaitStatus;
  output: string;
}): string {
  const output = input.output.trim();

  if (input.waitStatus !== 'timeout' && output) {
    return compactTelegramText(output);
  }

  if (input.waitStatus === 'timeout') {
    return compactTelegramText(['Timed out.', output || 'No worker output.'].join('\n\n'));
  }

  return 'Finished. No worker response.';
}

function compactTelegramText(text: string): string {
  const normalized = stripAnsi(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.trim() || lines[index - 1]?.trim())
    .join('\n')
    .trim();

  if (normalized.length <= MAX_TELEGRAM_RESULT_CHARS) {
    return normalized;
  }

  const tail = normalized.slice(normalized.length - MAX_TELEGRAM_RESULT_CHARS);
  const firstLineBreak = tail.indexOf('\n');
  return `...${firstLineBreak >= 0 ? tail.slice(firstLineBreak) : tail}`.trim();
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}
