import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { getLogs as getRelaySdkLogs } from '@agent-relay/sdk';
import { integrationPrompt } from './integrations.js';
import { writeRelayRunArtifact, type RelayLifecycleState, type RelayRunWaitStatus } from './relay-evidence.js';
import { createKarenStateClient } from './state.js';
import { ingestBurnLedger, stampBurnSession } from './token-consciousness.js';
import { workforceModelForRole, workforcePromptForRole } from './workforce.js';
import { redactError } from './redaction.js';
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
  waitForReady?(timeoutMs?: number): Promise<void>;
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
  listAgents?(): Promise<Array<RelayAgentHandle>>;
  shutdown(): Promise<void>;
};

type RelayConstructor = new (options: Record<string, unknown>) => RelayHandle;

type RelayClient = {
  onEvent(listener: (event: Record<string, unknown>) => void): () => void;
  spawnPty(input: {
    name: string;
    cli: string;
    task?: string;
    channels?: string[];
    cwd?: string;
    idleThresholdSecs?: number;
    model?: string;
    skipRelayPrompt?: boolean;
  }): Promise<{ name: string }>;
  sendMessage(input: {
    to: string;
    text: string;
    from: string;
    threadId?: string;
    priority?: number;
    data?: Record<string, unknown>;
  }): Promise<unknown>;
  listAgents(): Promise<Array<{ name: string }>>;
  shutdown(): Promise<void>;
};

type RelayClientFactory = {
  connect(options: { cwd: string; connectionPath?: string }): RelayClient;
};

type RelaySession = {
  key: string;
  relay: RelayHandle;
  agents: RelaySessionAgent[];
  brokerStderr: string;
  unscopedWorkerOutput: string;
  lifecycle: RelayExecutionLifecycle;
};

type RelaySessionAgent = {
  role: RelayAgentRole;
  agent: RelayAgentHandle;
  agentName: string;
  modelOrPersona: string;
  workerOutput: string;
  lastLogText: string;
  turns: number;
  reattached?: boolean;
};

type RelayExecutionStage =
  | 'session_starting'
  | 'session_ready'
  | 'broker_reused'
  | 'agent_started'
  | 'waiting_for_result'
  | 'completed'
  | 'timed_out'
  | 'failed';

type RelayExecutionLifecycle = {
  executionMode: OpenKarenConfig['agentMode'];
  workflow: OpenKarenConfig['agentRelayWorkflow'];
  cli: string;
  brokerReuse: 'fresh' | 'reused';
  currentStage: RelayExecutionStage;
  lastRole: RelayAgentRole | null;
};

let relayFactory: () => Promise<{ AgentRelay: RelayConstructor; AgentRelayClient?: RelayClientFactory }> = async () =>
  import('@agent-relay/sdk') as Promise<{ AgentRelay: RelayConstructor; AgentRelayClient?: RelayClientFactory }>;
let relayLogReaderForTesting: ((agentName: string, stateDir: string, lines?: number) => Promise<{ found: boolean; content?: string }>) | null = null;

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
  await ingestBurnLedger(config);

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
      'Queued for later execution.',
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
  const startedAt = new Date().toISOString();
  let session: RelaySession | null = null;

  try {
    await persistRelayLifecycle(config, turn, {
      sessionKey,
      startedAt,
      lifecycleState: 'accepted',
    });
    await persistRelayLifecycle(config, turn, {
      sessionKey,
      startedAt,
      lifecycleState: 'dispatched',
    });
    session = await getRelaySession(config, turn, sessionKey);
    await persistRelayLifecycle(config, turn, {
      sessionKey,
      startedAt,
      lifecycleState: 'working',
      session,
    });
    let result: AgentRunResult;

    if (config.agentRelayWorkflow === 'single') {
      result = await runSingleRelayTurn(config, turn, session);
    } else {
      result = await runOrchestratedRelayTurn(config, turn, session);
    }

    const waitStatus = result.relayWaitStatus ?? (result.timedOut ? 'timeout' : 'idle');
    await materializeRelayRunArtifact(config, turn, sessionKey, startedAt, session, {
      waitStatus,
      finalSummary: result.text,
    });
    await persistRelayLifecycle(config, turn, {
      sessionKey,
      startedAt,
      lifecycleState: relayWaitStatusLifecycle(waitStatus),
      session,
      completedAt: new Date().toISOString(),
      finalSummary: result.text,
    });

    return result;
  } catch (error) {
    const failureStatus: RelayRunWaitStatus = session ? 'failed_during_execution' : 'failed_to_start';
    console.error('OpenKaren relay turn failed', {
      lifecycleState: failureStatus,
      error: redactError(error),
    });

    relaySessions.delete(sessionKey);

    const result = {
      text: `OpenKaren relay ${failureStatus} through ${config.agentRelayCli}: ${redactError(error)}`,
      exitCode: null,
      timedOut: false,
      relayWaitStatus: failureStatus,
    };

    await materializeRelayRunArtifact(config, turn, sessionKey, startedAt, session, {
      waitStatus: failureStatus,
      finalSummary: result.text,
    });
    await persistRelayLifecycle(config, turn, {
      sessionKey,
      startedAt,
      lifecycleState: failureStatus,
      session,
      completedAt: new Date().toISOString(),
      finalSummary: result.text,
    });

    return result;
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
    if (member.agent.waitForReady) {
      await member.agent.waitForReady(config.agentTimeoutMs);
    }
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
      workflow: config.agentRelayWorkflow,
      brokerReuse: session.lifecycle.brokerReuse,
    }),
    exitCode: result.waitStatus === 'timeout' ? null : 0,
    timedOut: result.waitStatus === 'timeout',
    relayWaitStatus: result.waitStatus,
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
      if (member.agent.waitForReady) {
        await member.agent.waitForReady(config.agentTimeoutMs);
      }
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
          workflow: config.agentRelayWorkflow,
          brokerReuse: session.lifecycle.brokerReuse,
        }),
        exitCode: null,
        timedOut: true,
        relayWaitStatus: result.waitStatus,
      };
    }
  }

  return {
    text: formatRelayResult({
      agentName: relayWorkflowName(config, turn, 'verifier'),
      waitStatus: 'idle',
      output: outputs[outputs.length - 1] ?? handoff,
      workflow: config.agentRelayWorkflow,
      brokerReuse: session.lifecycle.brokerReuse,
    }),
    exitCode: 0,
    timedOut: false,
    relayWaitStatus: 'idle',
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
  const selectedModel = config.agentRelayModel ??
    workforceModelForRole(config, role, turn.spendSnapshot);
  const agent = await session.relay.spawnPty(
    {
      name: agentName,
      cli: config.agentRelayCli,
      task,
      channels: [config.agentRelayChannel],
      cwd: config.agentCwd,
      idleThresholdSecs: config.agentRelayIdleThresholdSecs,
      model: selectedModel ?? undefined,
      skipRelayPrompt: relayRuntime.skipRelayPrompt,
    },
  );
  const member: RelaySessionAgent = {
    role,
    agent,
    agentName,
    modelOrPersona: selectedModel ? `${role}:${selectedModel}` : `${role}:persona-selected`,
    workerOutput: '',
    lastLogText: '',
    turns: 0,
  };
  session.lifecycle.currentStage = 'agent_started';
  session.lifecycle.lastRole = role;
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
  session.lifecycle.currentStage = 'waiting_for_result';
  session.lifecycle.lastRole = member.role;
  const shouldSkipIdleWait = member.reattached && member.turns === 0;
  const waitStatus = shouldSkipIdleWait
    ? 'idle'
    : await member.agent.waitForIdle(config.agentTimeoutMs);
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

  session.lifecycle.currentStage = waitStatus === 'timeout'
    ? 'timed_out'
    : waitStatus === 'idle'
      ? 'completed'
      : 'failed';

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
      lifecycle: {
        executionMode: config.agentMode,
        workflow: config.agentRelayWorkflow,
        cli: config.agentRelayCli,
        brokerReuse: 'fresh',
        currentStage: 'session_starting',
        lastRole: null,
      },
    };

    console.info('OpenKaren relay session starting', {
      workflow: config.agentRelayWorkflow,
      cli: config.agentRelayCli,
      cwd: config.agentCwd,
      channel: config.agentRelayChannel,
      workspaceId: relayRuntime.workspaceId,
      localRelayCredentials: relayRuntime.usingLocalCredentials,
    });

    if (AgentRelayClient) {
      try {
        const connectedClient = AgentRelayClient.connect({
          cwd: config.agentCwd,
          connectionPath: join(relayStateDir, 'connection.json'),
        });
        relay = createConnectedRelayHandle(connectedClient, config.agentCwd, relayStateDir, session);
        session.lifecycle.brokerReuse = 'reused';
        session.lifecycle.currentStage = 'broker_reused';
      } catch {
        relay = null;
      }
    }

    if (!relay) {
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
        relay = connectToExistingRelayBrokerOrThrow(error, AgentRelayClient, config.agentCwd, relayStateDir, session);
      }
    }

    try {
      session.relay = relay;
      if (session.lifecycle.currentStage !== 'broker_reused') {
        session.lifecycle.currentStage = 'session_ready';
      }
      if (session.lifecycle.brokerReuse === 'reused') {
        await seedExistingRelayAgents(session);
      }
      console.info('OpenKaren relay broker reuse status', {
        sessionKey,
        brokerReused: session.lifecycle.brokerReuse === 'reused',
      });

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
      const reusedRelay = connectToExistingRelayBrokerOrThrow(error, AgentRelayClient, config.agentCwd, relayStateDir, session);
      session.relay = reusedRelay;
      await seedExistingRelayAgents(session);
      console.info('OpenKaren relay broker reuse status', {
        sessionKey,
        brokerReused: session.lifecycle.brokerReuse === 'reused',
      });

      reusedRelay.onWorkerOutput = ({ name, chunk }: { name?: string; chunk: string }) => {
        const target = name
          ? session.agents.find((member) => member.agent.name === name || member.agentName === name)
          : null;
        if (target) {
          target.workerOutput = appendBounded(target.workerOutput, chunk);
        } else {
          session.unscopedWorkerOutput = appendBounded(session.unscopedWorkerOutput, chunk);
        }
      };

      reusedRelay.onBrokerStderr?.((line) => {
        session.brokerStderr = appendBounded(session.brokerStderr, `${line}\n`);
      });

      return session;
    }
  } catch (error) {
    throw error;
  }
}

async function seedExistingRelayAgents(session: RelaySession): Promise<void> {
  const existingAgents = await session.relay.listAgents?.().catch(() => []) ?? [];
  for (const agent of existingAgents) {
    if (session.agents.some((member) => member.agent.name === agent.name || member.agentName === agent.name)) {
      continue;
    }
    const role = inferRelayRoleFromAgentName(agent.name);
    if (!role) {
      continue;
    }
    session.agents.push({
      role,
      agent,
      agentName: agent.name,
      modelOrPersona: `${role}:reattached`,
      workerOutput: '',
      lastLogText: '',
      turns: 0,
      reattached: true,
    });
  }
}

function inferRelayRoleFromAgentName(name: string): RelayAgentRole | null {
  if (name.endsWith('-planner')) return 'planner';
  if (name.endsWith('-implementer')) return 'implementer';
  if (name.endsWith('-reviewer')) return 'reviewer';
  if (name.endsWith('-verifier')) return 'verifier';
  return null;
}

function createConnectedRelayHandle(
  client: RelayClient,
  cwd: string,
  stateDir: string,
  session: RelaySession,
): RelayHandle {
  const knownAgents = new Map<string, RelayAgentHandle>();
  const readyAgents = new Set<string>();
  const messageReadyAgents = new Set<string>();
  const idleResolvers = new Map<string, Array<(status: RelayWaitStatus) => void>>();
  const readyResolvers = new Map<string, Array<() => void>>();

  const resolveIdle = (name: string, status: RelayWaitStatus) => {
    const resolvers = idleResolvers.get(name) ?? [];
    idleResolvers.delete(name);
    for (const resolve of resolvers) resolve(status);
  };

  const resolveReady = (name: string) => {
    const resolvers = readyResolvers.get(name) ?? [];
    readyResolvers.delete(name);
    for (const resolve of resolvers) resolve();
  };

  const markAgentReady = (name: string) => {
    readyAgents.add(name);
    messageReadyAgents.add(name);
    resolveReady(name);
  };

  const ensureAgentHandle = (name: string): RelayAgentHandle => {
    const existing = knownAgents.get(name);
    if (existing) {
      return existing;
    }
    const handle: RelayAgentHandle = {
      name,
      async waitForReady(timeoutMs = 60_000) {
        if (messageReadyAgents.has(name) || readyAgents.has(name)) {
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for relay agent '${name}' to become ready after ${timeoutMs}ms`));
          }, timeoutMs);
          const current = readyResolvers.get(name) ?? [];
          current.push(() => {
            clearTimeout(timer);
            resolve();
          });
          readyResolvers.set(name, current);
        });
      },
      async waitForIdle(timeoutMs) {
        if (timeoutMs === 0) {
          return 'timeout';
        }
        return await new Promise<RelayWaitStatus>((resolve) => {
          const timer = timeoutMs === undefined ? null : setTimeout(() => {
            resolve('timeout');
          }, timeoutMs);
          const current = idleResolvers.get(name) ?? [];
          current.push((status) => {
            if (timer) clearTimeout(timer);
            resolve(status);
          });
          idleResolvers.set(name, current);
        });
      },
      async release(options) {
        const reason = typeof options === 'string' ? options : options?.reason;
        await client.sendMessage({ to: name, from: 'OpenKaren Telegram', text: '/exit', data: reason ? { reason } : undefined });
      },
    };
    knownAgents.set(name, handle);
    return handle;
  };

  const relayHandle: RelayHandle = {
    onWorkerOutput: null,
    onBrokerStderr(listener) {
      return () => listener;
    },
    async spawnPty(input) {
      const spawned = await client.spawnPty(input);
      return ensureAgentHandle(spawned.name);
    },
    human(options) {
      return {
        async sendMessage(input) {
          await client.sendMessage({
            to: input.to,
            text: input.text,
            from: options.name,
            threadId: input.threadId,
            priority: input.priority,
            data: input.data,
          });
          return {};
        },
      };
    },
    async getLogs(agentName, options) {
      if (relayLogReaderForTesting) {
        return await relayLogReaderForTesting(agentName, stateDir, options?.lines);
      }
      return await getRelaySdkLogs(agentName, {
        logsDir: join(stateDir, 'worker-logs'),
        lines: options?.lines,
      });
    },
    async listAgents() {
      const agents = await client.listAgents();
      return agents.map((agent) => {
        const handle = ensureAgentHandle(agent.name);
        markAgentReady(agent.name);
        return handle;
      });
    },
    async shutdown() {
      unsubscribe();
      await client.shutdown();
    },
  };

  const unsubscribe = client.onEvent((event) => {
    const kind = typeof event.kind === 'string' ? event.kind : null;
    if (!kind) return;

    if (kind === 'worker_stream') {
      const name = typeof event.name === 'string' ? event.name : undefined;
      const chunk = typeof event.chunk === 'string' ? event.chunk : '';
      if (name && chunk) {
        relayHandle.onWorkerOutput?.({ name, chunk });
      }
      return;
    }

    if (kind === 'worker_ready' || kind === 'relay_inbound') {
      const name = kind === 'worker_ready'
        ? (typeof event.name === 'string' ? event.name : undefined)
        : (typeof event.from === 'string' ? event.from : undefined);
      if (name) {
        ensureAgentHandle(name);
        markAgentReady(name);
        if (kind === 'relay_inbound') {
          resolveIdle(name, 'idle');
        }
      }
      return;
    }

    if (kind === 'agent_idle') {
      const name = typeof event.name === 'string' ? event.name : undefined;
      if (name) {
        resolveIdle(name, 'idle');
      }
      return;
    }

    if (kind === 'agent_exited' || kind === 'agent_released') {
      const name = typeof event.name === 'string' ? event.name : undefined;
      if (name) {
        resolveIdle(name, 'exited');
      }
    }
  });

  return relayHandle;
}

function connectToExistingRelayBrokerOrThrow(
  error: unknown,
  agentRelayClient: RelayClientFactory | undefined,
  cwd: string,
  stateDir: string,
  session: RelaySession,
): RelayHandle {
  const message = error instanceof Error ? error.message : String(error);
  const canReuseExistingBroker = message.includes('another broker instance is already running in this directory');

  if (!canReuseExistingBroker || !agentRelayClient) {
    throw error;
  }

  console.warn('OpenKaren reusing existing relay broker', {
    cwd,
    stateDir,
    brokerReused: true,
  });
  session.lifecycle.brokerReuse = 'reused';
  session.lifecycle.currentStage = 'broker_reused';
  const connectedClient = agentRelayClient.connect({
    cwd,
    connectionPath: join(stateDir, 'connection.json'),
  });
  return createConnectedRelayHandle(connectedClient, cwd, stateDir, session);
}


async function materializeRelayRunArtifact(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  sessionKey: string,
  startedAt: string,
  session: RelaySession | null,
  result: { waitStatus: RelayRunWaitStatus; finalSummary: string },
): Promise<void> {
  await writeRelayRunArtifact(config, {
    messageId: turn.message.id,
    sessionKey,
    workflowMode: config.agentRelayWorkflow,
    rolesSpawned: session?.agents.map((member) => member.role) ?? [],
    modelsOrPersonas: session?.agents.map((member) => member.modelOrPersona) ?? [],
    brokerReused: session?.lifecycle.brokerReuse === 'reused',
    startedAt,
    completedAt: new Date().toISOString(),
    waitStatus: result.waitStatus,
    finalSummary: result.finalSummary,
  });
}

async function persistRelayLifecycle(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
  input: {
    sessionKey: string;
    startedAt: string;
    lifecycleState: RelayLifecycleState;
    session?: RelaySession | null;
    completedAt?: string;
    finalSummary?: string;
  },
): Promise<void> {
  if (!config.stateWorkerUrl) {
    return;
  }

  await createKarenStateClient(config).putActiveRelayTurn({
    messageId: turn.message.id,
    sessionKey: input.sessionKey,
    surfaceId: turn.message.surfaceId,
    targetId: turn.chatId,
    workflowMode: config.agentRelayWorkflow,
    lifecycleState: input.lifecycleState,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
    completedAt: input.completedAt ?? null,
    rolesSpawned: input.session?.agents.map((member) => member.role) ?? [],
    brokerReused: input.session?.lifecycle.brokerReuse === 'reused',
    finalSummary: input.finalSummary,
  }).catch((error: unknown) => {
    console.warn('OpenKaren relay lifecycle persistence failed', {
      lifecycleState: input.lifecycleState,
      error: redactError(error),
    });
  });
}

function relayWaitStatusLifecycle(waitStatus: RelayRunWaitStatus): RelayLifecycleState {
  if (waitStatus === 'timeout') {
    return 'timed_out';
  }

  if (waitStatus === 'failed_to_start' || waitStatus === 'failed_during_execution') {
    return waitStatus;
  }

  return 'completed';
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

export function setRelayLogReaderForTesting(
  reader: ((agentName: string, stateDir: string, lines?: number) => Promise<{ found: boolean; content?: string }>) | null,
): void {
  relayLogReaderForTesting = reader;
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
      error: redactError(error),
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
  workflow?: OpenKarenConfig['agentRelayWorkflow'];
  brokerReuse?: 'fresh' | 'reused';
}): string {
  const output = input.output.trim();

  if (input.waitStatus !== 'timeout' && output) {
    return compactTelegramText(shapeRelayCompletion(output));
  }

  if (input.waitStatus === 'timeout') {
    return compactTelegramText([
      'Relay state: timed_out.',
      `Relay ${input.workflow ?? 'execution'} timed out before I got a clean completion summary.`,
      input.brokerReuse === 'reused' ? 'This turn was attached to an already-running broker.' : null,
      output ? `Last useful output:\n${shapeRelayCompletion(output)}` : 'No worker output.',
    ].filter(Boolean).join('\n\n'));
  }

  return [
    `Relay ${input.workflow ?? 'execution'} finished, but the worker did not leave a useful completion summary.`,
    input.brokerReuse === 'reused' ? 'It did reuse an already-running broker cleanly.' : null,
  ].filter(Boolean).join(' ');
}

function shapeRelayCompletion(output: string): string {
  const normalized = stripAnsi(output)
    .replace(/\u0007/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!normalized) {
    return '';
  }

  const cleanedLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isRelayUiNoiseLine(line));

  if (cleanedLines.length === 0) {
    return '';
  }

  const cleaned = cleanedLines.join('\n').trim();

  if (/^(changed|updated|fixed|implemented|verified|queued|reviewed|added)\b/i.test(cleaned)) {
    return cleaned;
  }

  if (/^\[[^\]]+\]\s*$/m.test(cleaned) || cleaned.includes('[verifier]')) {
    const lines = cleanedLines.filter((line) => !/^\[[^\]]+\]$/.test(line));
    const collapsed = lines.join('\n').trim();
    return collapsed || cleaned;
  }

  const candidateBlocks = cleaned
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .filter((block) => !isRelayUiNoiseBlock(block));

  return candidateBlocks.at(-1) ?? cleaned;
}

function isRelayUiNoiseLine(line: string): boolean {
  return /^Tip:/i.test(line)
    || /^model:/i.test(line)
    || /^directory:/i.test(line)
    || /^permissions:/i.test(line)
    || /^>_\s+/i.test(line)
    || /^OpenAI Codex/i.test(line)
    || /^Starting MCP servers/i.test(line)
    || /^Booting MCP server/i.test(line)
    || /^Implement \{feature\}/i.test(line)
    || /^[•◦⠋⠏⠙⠹⠸⠼]+/.test(line)
    || /^[╭╰│─]+$/.test(line)
    || /^esc to interrupt\)?$/i.test(line)
    || /^\/model to change$/i.test(line)
    || /^~/i.test(line) && line.includes('/openkaren');
}

function isRelayUiNoiseBlock(block: string): boolean {
  const simplified = block.replace(/\s+/g, ' ').trim();
  return simplified.length < 24 && /^(starting|booting|implement|openkaren|codex_apps|relaycast)$/i.test(simplified);
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
