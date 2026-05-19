import { execFileSync } from 'node:child_process';
import {
  createAssistant,
  createSessionStore,
  createSurfaceRegistry,
  createTraitsProvider,
  InMemorySessionStoreAdapter,
  type InboundMessage,
} from '@agent-assistant/sdk';
import { runOpenKarenTurn, shutdownOpenKarenRelaySessions } from './agent-runner.js';
import {
  normalizeTelegramUpdate,
  TelegramBot,
  TELEGRAM_SURFACE_ID,
} from './telegram.js';
import {
  normalizeSlackEvent,
  sendSlackFormatted,
  slackFormat,
  SLACK_SURFACE_ID,
} from './slack.js';
import {
  normalizeRelaycastWebhook,
  relaycastFormat,
  RelaycastWebhookServer,
  RELAYCAST_SURFACE_ID,
  sendRelaycastFormatted,
} from './relaycast.js';
import {
  startRelayCronProactiveSchedules,
  startRelayCronProgress,
  type RelayCronProactiveTurn,
  type RelayCronProgressTurn,
} from './relaycron.js';
import { integrationStatuses, integrationStatusText } from './integrations.js';
import { inboxEventText, type OpenKarenInboxEvent } from './inbox.js';
import { decideQuestionRoute } from './question-router.js';
import { relayfileEventText, RelayfileWatcher, type RelayfileWatchEvent } from './relayfile.js';
import { routeOpenKarenMessage } from './routing.js';
import { createKarenStateClient, type KarenStateClient } from './state.js';
import {
  budgetGateText,
  forecastText,
  readSpendSnapshot,
  spendText,
  stampBurnSession,
} from './token-consciousness.js';
import type {
  AgentRunResult,
  OpenKarenConfig,
  OpenKarenTurn,
  QuestionRouterContextPacket,
  QuestionRouterDecision,
  QuestionRouterIntent,
  RelaycastWebhookPayload,
  SlackEventPayload,
  TelegramUpdate,
} from './types.js';

const ACKNOWLEDGEMENTS = [
  'I see the problem. Rude of it.',
  'Taking it apart now.',
  'Delegating. With supervision, obviously.',
  'I found the thread. Pulling.',
  'Into the code mines.',
  'Checking the damage.',
  'I will make it less wrong.',
  'Good. A real task.',
  'This smells fixable.',
  'Summoning the tiny committee.',
  'Let me bully the repo a little.',
  'Working. Elegance pending.',
];

let acknowledgementIndex = 0;

type ActiveCodingTurn = {
  messageId: string;
  targetId: string;
  surfaceId: string;
  startedAt: string;
  mode: OpenKarenConfig['agentMode'];
  text: string;
};

type ProactiveCodingInput = {
  message: InboundMessage;
  targetId: string;
  surfaceId: string;
  format: Record<string, unknown>;
  busyText: string;
};

type DirectQuestionIntent =
  | 'architecture'
  | 'recentChanges'
  | 'model'
  | 'skills'
  | 'integrations'
  | 'integrationDepth'
  | 'improvementAdvice'
  | 'status'
  | 'capabilities';

type QuestionRoute =
  | {
    kind: 'chat';
    intent: DirectQuestionIntent | 'general' | 'clarify' | null;
    decidedBy: 'llm' | 'fallback';
    decisionRoute: QuestionRouterDecision['route'];
    semanticIntent?: QuestionRouterIntent;
    reason?: string;
  }
  | {
    kind: 'coding';
    intent: 'task';
    decidedBy: 'llm' | 'fallback';
    decisionRoute: QuestionRouterDecision['route'];
    semanticIntent?: QuestionRouterIntent;
    reason?: string;
  };

export type OpenKarenRuntime = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createOpenKaren(config: OpenKarenConfig): OpenKarenRuntime {
  const telegram = new TelegramBot(config);
  const relaycast = new RelaycastWebhookServer(
    config,
    (payload) => {
      surfaces.receiveRaw(RELAYCAST_SURFACE_ID, payload);
    },
    (turn) => {
      void emitRelayCronProgress(turn);
    },
    (turn) => {
      void handleRelayCronProactive(turn);
    },
    (event) => {
      void handleInboxEvent(event);
    },
    (payload) => {
      surfaces.receiveRaw(SLACK_SURFACE_ID, payload);
    },
    (event) => {
      void state.upsertNangoConnection(event.connection);
    },
  );
  let activeCodingTurn: ActiveCodingTurn | null = null;
  let relayCronProactive: Awaited<ReturnType<typeof startRelayCronProactiveSchedules>> | null = null;
  const relayfileWatcher = new RelayfileWatcher(config, (event) => {
    void handleRelayfileEvent(event);
  });
  const sessions = createSessionStore({
    adapter: new InMemorySessionStoreAdapter(),
  });
  const state = createKarenStateClient(config);

  const surfaces = createSurfaceRegistry({
    normalizationHook(surfaceId, raw) {
      if (surfaceId === TELEGRAM_SURFACE_ID) {
        return normalizeTelegramUpdate(surfaceId, raw as TelegramUpdate);
      }

      if (surfaceId === RELAYCAST_SURFACE_ID) {
        return normalizeRelaycastWebhook(surfaceId, raw as RelaycastWebhookPayload);
      }

      if (surfaceId === SLACK_SURFACE_ID) {
        return normalizeSlackEvent(surfaceId, raw as SlackEventPayload);
      }

      return null;
    },
  });

  surfaces.register({
    id: TELEGRAM_SURFACE_ID,
    type: 'telegram',
    state: 'active',
    capabilities: {
      markdown: false,
      richBlocks: false,
      attachments: false,
      streaming: false,
      maxResponseLength: 3900,
    },
    adapter: {
      async send(payload) {
        await telegram.sendFormatted(payload.formatted, payload.event.text);
      },
      onConnect() {},
      onDisconnect() {},
    },
    formatHook(event) {
      return event.format ?? {};
    },
  });

  surfaces.register({
    id: RELAYCAST_SURFACE_ID,
    type: 'relaycast',
    state: config.relaycastEnabled ? 'active' : 'inactive',
    capabilities: {
      markdown: false,
      richBlocks: false,
      attachments: false,
      streaming: false,
      maxResponseLength: 3900,
    },
    adapter: {
      async send(payload) {
        await sendRelaycastFormatted(payload.formatted, payload.event.text);
      },
      onConnect() {},
      onDisconnect() {},
    },
    formatHook(event) {
      return event.format ?? {};
    },
  });

  surfaces.register({
    id: SLACK_SURFACE_ID,
    type: 'slack',
    state: config.slackEnabled ? 'active' : 'inactive',
    capabilities: {
      markdown: true,
      richBlocks: false,
      attachments: false,
      streaming: false,
      maxResponseLength: 3900,
    },
    adapter: {
      async send(payload) {
        await sendSlackFormatted(config, payload.formatted, payload.event.text);
      },
      onConnect() {},
      onDisconnect() {},
    },
    formatHook(event) {
      return event.format ?? {};
    },
  });

  const traits = createTraitsProvider(
    {
      voice: 'conversational',
      formality: 'casual',
      proactivity: 'high',
      riskPosture: 'moderate',
      domain: 'software engineering',
      vocabulary: [
        'genuinely funny',
        'sarcastic',
        'occasionally biting',
        'sharp',
        'irreverent',
        'engineering-first',
        'viral',
        'self-improving',
      ],
    },
    { preferMarkdown: false },
  );

  const assistant = createAssistant(
    {
      id: 'openkaren',
      name: 'OpenKaren',
      description: 'A Telegram-first assistant that develops OpenKaren using OpenKaren.',
      traits,
      constraints: {
        handlerTimeoutMs: config.agentTimeoutMs + 30_000,
        maxConcurrentHandlers: 4,
      },
      capabilities: {
        chat: async (message, context) => {
          const target = getMessageTarget(message);
          if (!target) {
            return;
          }

          await ensureSession(sessions, state, message, target);

          if (
            target.surfaceId === TELEGRAM_SURFACE_ID &&
            !telegram.isAllowedChat(target.targetId)
          ) {
            await telegram.sendText(
              target.targetId,
              'This chat is not allowed to use this OpenKaren instance.',
            );
            return;
          }

          const command = message.text.trim();
          const forcedTask = parseDoCommand(command);
          if (command === '/start' || command === '/help') {
            const reply = helpText(config);
            await context.runtime.emit({
              surfaceId: target.surfaceId,
              text: reply,
              format: target.format,
            });
            await recordAssistantMessage(state, message, reply);
            return;
          }

          if (command === '/status') {
            const reply = statusText(config, activeCodingTurn);
            await context.runtime.emit({
              surfaceId: target.surfaceId,
              text: reply,
              format: target.format,
            });
            await recordAssistantMessage(state, message, reply);
            return;
          }

          if (command === '/integrations') {
            const reply = integrationStatusText(config);
            await context.runtime.emit({
              surfaceId: target.surfaceId,
              text: reply,
              format: target.format,
            });
            await recordAssistantMessage(state, message, reply);
            return;
          }

          if (command === '/spend') {
            const snapshot = await readSpendSnapshot(config, message.userId);
            const reply = spendText(snapshot);
            await context.runtime.emit({
              surfaceId: target.surfaceId,
              text: reply,
              format: target.format,
            });
            await recordAssistantMessage(state, message, reply);
            return;
          }

          if (command === '/forecast') {
            const snapshot = await readSpendSnapshot(config, message.userId);
            const reply = forecastText(snapshot);
            await context.runtime.emit({
              surfaceId: target.surfaceId,
              text: reply,
              format: target.format,
            });
            await recordAssistantMessage(state, message, reply);
            return;
          }

          if (forcedTask !== null) {
            if (!forcedTask) {
              const reply = 'Use /do followed by a task, for example /do fix the failing tests.';
              await context.runtime.emit({
                surfaceId: target.surfaceId,
                text: reply,
                format: target.format,
              });
              await recordAssistantMessage(state, message, reply);
              return;
            }

            await recordInboundMessage(state, message);
            await runCodingTurn({
              rawText: message.text,
              effectiveText: forcedTask,
              message,
              target,
              state,
              context,
            });
            return;
          }

          const route = await routeQuestion(message.text, config, state, activeCodingTurn);
          console.info('question-router: routed message', {
            messageId: message.id,
            surfaceId: target.surfaceId,
            targetId: target.targetId,
            decided_by: route.decidedBy,
            route: route.decisionRoute,
            intent: route.intent,
            semanticIntent: route.semanticIntent,
          });

          await recordInboundMessage(state, message);

          if (route.kind === 'chat') {
            const reply = await chatReplyText(message.text, config, state, activeCodingTurn, route.intent);
            await context.runtime.emit({
              surfaceId: target.surfaceId,
              text: reply,
              format: target.format,
            });
            await recordAssistantMessage(state, message, reply);
            return;
          }

          await runCodingTurn({
            rawText: message.text,
            effectiveText: message.text,
            message,
            target,
            state,
            context,
          });
        },
      },
      hooks: {
        onError(error, message) {
          console.error('OpenKaren turn failed', {
            error: error.message,
            messageId: message.id,
            surfaceId: message.surfaceId,
          });
        },
      },
    },
    {
      inbound: surfaces,
      outbound: surfaces,
    },
  );

  assistant.register('sessions', sessions);

  return {
    async start() {
      await assistant.start();
      await startWebhookListener();
      startRelayfileWatcher();
      void startProactiveSchedules();
      await telegram.start((update) => {
        surfaces.receiveRaw(TELEGRAM_SURFACE_ID, update);
      });
    },
    async stop() {
      relayfileWatcher.stop();
      await relayCronProactive?.stop().catch((error: unknown) => {
        console.warn('OpenKaren RelayCron proactive stop failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      relayCronProactive = null;
      await relaycast.stop().catch((error: unknown) => {
        console.warn('OpenKaren webhook listener stop failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      telegram.stop();
      await assistant.stop();
    },
  };

  async function startWebhookListener(): Promise<void> {
    await relaycast.start().catch((error: unknown) => {
      console.warn('OpenKaren webhook listener unavailable; Telegram will stay online', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  function startRelayfileWatcher(): void {
    try {
      relayfileWatcher.start();
    } catch (error) {
      console.warn('OpenKaren Relayfile watcher unavailable; Telegram will stay online', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function startProactiveSchedules(): Promise<void> {
    relayCronProactive = await startRelayCronProactiveSchedules(
      config,
      primaryTelegramTarget(config),
    ).catch((error: unknown) => {
      console.warn('OpenKaren proactive schedules unavailable; Telegram will stay online', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
  }

  async function emitRelayCronProgress(turn: RelayCronProgressTurn): Promise<void> {
    if (!activeCodingTurn || activeCodingTurn.messageId !== turn.messageId) {
      console.info('OpenKaren ignored stale RelayCron progress tick', {
        messageId: turn.messageId,
      });
      return;
    }

    await assistant.emit({
      surfaceId: turn.surfaceId,
      text: relayProgressText(activeCodingTurn),
      format: surfaceFormatForProgress(turn),
    });
  }

  async function handleRelayCronProactive(turn: RelayCronProactiveTurn): Promise<void> {
    if (activeCodingTurn) {
      await assistant.emit({
        surfaceId: turn.surfaceId,
        text: 'Scheduled tick landed. I am already working, because apparently linear time has opinions.',
        format: surfaceFormatForProactive(turn),
      });
      return;
    }

    if (turn.scheduleName === 'weekly-spend-review') {
      const snapshot = await readSpendSnapshot(config, turn.targetId);
      await assistant.emit({
        surfaceId: turn.surfaceId,
        text: [spendText(snapshot), forecastText(snapshot)].join('\n'),
        format: surfaceFormatForProactive(turn),
      });
      return;
    }

    const syntheticMessage = {
      id: `relaycron:${turn.scheduleName}:${Date.now()}`,
      surfaceId: turn.surfaceId,
      sessionId: `${turn.surfaceId}:${turn.targetId}`,
      userId: turn.targetId,
      workspaceId: `${turn.surfaceId}:${turn.targetId}`,
      text: proactiveDevelopmentPrompt(turn.scheduleName),
      raw: { relaycron: turn },
      receivedAt: turn.firedAt,
      capability: 'chat',
    };

    await runProactiveCodingTurn({
      message: syntheticMessage,
      targetId: turn.targetId,
      surfaceId: turn.surfaceId,
      format: surfaceFormatForProactive(turn),
      busyText: 'Scheduled tick landed. I am already working, because apparently linear time has opinions.',
    });
  }

  async function handleRelayfileEvent(event: RelayfileWatchEvent): Promise<void> {
    const target = primaryTelegramTarget(config);
    if (!target) {
      console.info('OpenKaren Relayfile event has no primary Telegram target', {
        path: event.relativePath,
      });
      return;
    }

    await assistant.emit({
      surfaceId: target.surfaceId,
      text: relayfileEventText(event),
      format: { chatId: target.targetId },
    });
  }

  async function handleInboxEvent(event: OpenKarenInboxEvent): Promise<void> {
    const target = primaryTelegramTarget(config);
    if (!target) {
      console.info('OpenKaren inbox event has no primary Telegram target', {
        source: event.source,
      });
      return;
    }

    const syntheticMessage = {
      id: `inbox:${event.source}:${Date.now()}`,
      surfaceId: target.surfaceId,
      sessionId: `${target.surfaceId}:${target.targetId}`,
      userId: target.targetId,
      workspaceId: `${target.surfaceId}:${target.targetId}`,
      text: inboxDevelopmentPrompt(event),
      raw: { inbox: event },
      receivedAt: event.receivedAt,
      capability: 'chat',
    };

    await runProactiveCodingTurn({
      message: syntheticMessage,
      targetId: target.targetId,
      surfaceId: target.surfaceId,
      format: { chatId: target.targetId },
      busyText: `${inboxEventText(event)}. I am already working, so this is noted rather than spawned.`,
    });
  }

  async function runProactiveCodingTurn(input: ProactiveCodingInput): Promise<void> {
    if (activeCodingTurn) {
      await assistant.emit({
        surfaceId: input.surfaceId,
        text: input.busyText,
        format: input.format,
      });
      return;
    }

    const spendSnapshot = await readSpendSnapshot(config, input.message.userId);
    const budgetBlock = budgetGateText(spendSnapshot);
    if (budgetBlock) {
      await assistant.emit({
        surfaceId: input.surfaceId,
        text: budgetBlock,
        format: input.format,
      });
      return;
    }

    activeCodingTurn = {
      messageId: input.message.id,
      targetId: input.targetId,
      surfaceId: input.surfaceId,
      startedAt: new Date().toISOString(),
      mode: config.agentMode,
      text: input.message.text,
    };

    await assistant.emit({
      surfaceId: input.surfaceId,
      text: codingTurnAcknowledgement(config, input.message.text),
      format: input.format,
    });

    const relayCronProgress = await startRelayCronProgress(config, activeCodingTurn);
    const stopProgressTimer = relayCronProgress.enabled
      ? () => {}
      : startRelayProgressTimer(config, async () => {
        await assistant.emit({
          surfaceId: input.surfaceId,
          text: relayProgressText(activeCodingTurn),
          format: input.format,
        });
      });

    try {
      const result = await runOpenKarenTurnWithHardTimeout(config, {
        message: input.message,
        chatId: input.targetId,
        text: input.message.text,
        spendSnapshot,
      });
      await assistant.emit({
        surfaceId: input.surfaceId,
        text: result.text,
        format: input.format,
      });
    } finally {
      stopProgressTimer();
      await relayCronProgress.stop();
      activeCodingTurn = null;
    }
  }

  async function runCodingTurn(input: {
    rawText: string;
    effectiveText: string;
    message: InboundMessage;
    target: { targetId: string; surfaceId: string; format: Record<string, unknown> };
    state: KarenStateClient;
    context: { runtime: { emit(event: { surfaceId: string; text: string; format: Record<string, unknown> }): Promise<void> } };
  }): Promise<void> {
    if (activeCodingTurn) {
      await input.context.runtime.emit({
        surfaceId: input.target.surfaceId,
        text: relayProgressText(activeCodingTurn),
        format: input.target.format,
      });
      return;
    }

    const spendSnapshot = await readSpendSnapshot(config, input.message.userId);
    const budgetBlock = budgetGateText(spendSnapshot);
    if (budgetBlock) {
      await input.context.runtime.emit({
        surfaceId: input.target.surfaceId,
        text: budgetBlock,
        format: input.target.format,
      });
      return;
    }

    const acknowledgement = codingTurnAcknowledgement(config, input.effectiveText);
    await input.context.runtime.emit({
      surfaceId: input.target.surfaceId,
      text: acknowledgement,
      format: input.target.format,
    });
    await recordAssistantMessage(input.state, input.message, acknowledgement);

    activeCodingTurn = {
      messageId: input.message.id,
      targetId: input.target.targetId,
      surfaceId: input.target.surfaceId,
      startedAt: new Date().toISOString(),
      mode: config.agentMode,
      text: input.effectiveText,
    };
    console.info('OpenKaren coding turn started', {
      messageId: input.message.id,
      surfaceId: input.target.surfaceId,
      targetId: input.target.targetId,
      mode: config.agentMode,
    });

    const relayCronProgress = await startRelayCronProgress(config, activeCodingTurn);
    const stopProgressTimer = relayCronProgress.enabled
      ? () => {}
      : startRelayProgressTimer(config, async () => {
        await input.context.runtime.emit({
          surfaceId: input.target.surfaceId,
          text: relayProgressText(activeCodingTurn),
          format: input.target.format,
        });
      });

    try {
      const result = await runOpenKarenTurnWithHardTimeout(config, {
        message: input.message,
        chatId: input.target.targetId,
        text: input.effectiveText,
        spendSnapshot,
      });

      await input.context.runtime.emit({
        surfaceId: input.target.surfaceId,
        text: result.text,
        format: input.target.format,
      });
      await recordAssistantMessage(input.state, input.message, result.text);
    } finally {
      stopProgressTimer();
      await relayCronProgress.stop();
      console.info('OpenKaren coding turn finished', {
        messageId: input.message.id,
        surfaceId: input.target.surfaceId,
        targetId: input.target.targetId,
        mode: config.agentMode,
      });
      activeCodingTurn = null;
    }
  }
}

async function recordInboundMessage(
  state: KarenStateClient,
  message: InboundMessage,
): Promise<void> {
  try {
    await state.appendMessage({
      sessionId: message.sessionId ?? `${message.surfaceId}:${message.userId}`,
      role: 'user',
      content: message.text,
      messageId: message.id,
    });
  } catch (error) {
    console.warn('OpenKaren could not record inbound message for local context', {
      error: error instanceof Error ? error.message : String(error),
      messageId: message.id,
    });
  }
}

async function recordAssistantMessage(
  state: KarenStateClient,
  message: InboundMessage,
  text: string,
): Promise<void> {
  try {
    await state.appendMessage({
      sessionId: message.sessionId ?? `${message.surfaceId}:${message.userId}`,
      role: 'assistant',
      content: text,
      messageId: `${message.id}:assistant`,
    });
  } catch (error) {
    console.warn('OpenKaren could not record assistant message for local context', {
      error: error instanceof Error ? error.message : String(error),
      messageId: message.id,
    });
  }
}

export function nextAcknowledgement(text = ''): string {
  const lower = text.toLowerCase();
  if (/\b(bug|broken|error|fail|failing|fix|stuck|debug)\b/.test(lower)) {
    return pickAcknowledgement([
      'Checking the damage.',
      'I see the problem. Rude of it.',
      'This smells fixable.',
      'I will make it less wrong.',
    ]);
  }

  if (/\b(add|build|implement|wire|create|scaffold)\b/.test(lower)) {
    return pickAcknowledgement([
      'Good. A real task.',
      'Into the code mines.',
      'Taking it apart now.',
      'Working. Elegance pending.',
    ]);
  }

  if (/\b(review|audit|inspect|check)\b/.test(lower)) {
    return pickAcknowledgement([
      'Checking the damage.',
      'I found the thread. Pulling.',
      'Summoning the tiny committee.',
      'Let me bully the repo a little.',
    ]);
  }

  return pickAcknowledgement(ACKNOWLEDGEMENTS);
}

function codingTurnAcknowledgement(config: OpenKarenConfig, text = ''): string {
  const base = nextAcknowledgement(text);
  if (config.agentMode === 'relay') {
    return `${base} Sending it through relay now.`;
  }
  if (config.agentMode === 'command') {
    return `${base} Running it through the local command path now.`;
  }
  return `${base} Queue mode is on, so I am dropping it into the local execution inbox.`;
}

function pickAcknowledgement(options: readonly string[]): string {
  const acknowledgement = options[acknowledgementIndex % options.length];
  acknowledgementIndex += 1;
  return acknowledgement;
}

async function ensureSession(
  sessions: ReturnType<typeof createSessionStore>,
  state: KarenStateClient,
  message: InboundMessage,
  target: MessageTarget,
): Promise<void> {
  const sessionId = message.sessionId ?? `${target.surfaceId}:${target.targetId}`;
  const existing = await sessions.get(sessionId);

  if (existing) {
    await sessions.touch(sessionId);
    await bridgeStateSession(state, message, target, sessionId);
    return;
  }

  try {
    await sessions.create({
      id: sessionId,
      userId: message.userId,
      workspaceId: message.workspaceId,
      initialSurfaceId: target.surfaceId,
      metadata: { targetId: target.targetId },
    });
  } catch (error) {
    if (!isDuplicateSessionError(error)) {
      throw error;
    }
  }
  await sessions.touch(sessionId);
  await bridgeStateSession(state, message, target, sessionId);
}

function isDuplicateSessionError(error: unknown): boolean {
  return error instanceof Error && /session already exists/i.test(error.message);
}

async function bridgeStateSession(
  state: KarenStateClient,
  message: InboundMessage,
  target: MessageTarget,
  sessionId: string,
): Promise<void> {
  await state.getOrCreateBridgeSession({
    surface: target.surfaceId === SLACK_SURFACE_ID
      ? 'slack'
      : target.surfaceId === RELAYCAST_SURFACE_ID
        ? 'relaycast'
        : 'telegram',
    channelId: target.targetId,
    userId: message.userId,
    existingBridgeId: sessionId.startsWith('bridge:') ? sessionId : undefined,
  }).catch((error: unknown) => {
    console.warn('OpenKaren state session bridge failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

type MessageTarget = {
  surfaceId: string;
  targetId: string;
  format: Record<string, unknown>;
};

function getMessageTarget(message: InboundMessage): MessageTarget | null {
  if (message.surfaceId === TELEGRAM_SURFACE_ID) {
    const chatId = getTelegramChatId(message);
    return chatId ? { surfaceId: TELEGRAM_SURFACE_ID, targetId: chatId, format: { chatId } } : null;
  }

  if (message.surfaceId === RELAYCAST_SURFACE_ID) {
    return {
      surfaceId: RELAYCAST_SURFACE_ID,
      targetId: message.sessionId ?? message.userId,
      format: relaycastFormat((message.raw as { relaycast?: RelaycastWebhookPayload }).relaycast ?? {}),
    };
  }

  if (message.surfaceId === SLACK_SURFACE_ID) {
    const raw = message.raw as { slack?: SlackEventPayload };
    const format = raw.slack ? slackFormat(raw.slack) : {};
    return {
      surfaceId: SLACK_SURFACE_ID,
      targetId: format.channelId ?? message.userId,
      format,
    };
  }

  return null;
}

function getTelegramChatId(message: InboundMessage): string | null {
  const raw = message.raw as { telegram?: TelegramUpdate };
  const chatId = raw.telegram?.message?.chat?.id;
  return typeof chatId === 'number' ? String(chatId) : null;
}

function parseDoCommand(text: string): string | null {
  if (text === '/do') {
    return '';
  }
  if (!text.startsWith('/do ')) {
    return null;
  }
  return text.slice(4).trim();
}

function helpText(config: OpenKarenConfig): string {
  return [
    'Online.',
    'Send work. I edit.',
    '/status state. /integrations wiring.',
    config.agentMode === 'relay'
      ? `Relay: ${config.agentRelayCli}`
      : config.agentMode === 'command'
        ? `Command: ${config.agentCommand}`
        : 'Queue mode.',
  ].join('\n');
}

async function chatReplyText(
  text: string,
  config: OpenKarenConfig,
  state: KarenStateClient,
  activeCodingTurn: ActiveCodingTurn | null,
  routedIntent: DirectQuestionIntent | 'general' | 'clarify' | null = null,
): Promise<string> {
  const normalized = normalizeCasualText(text);
  const directAnswer = await directQuestionReply(normalized, config, state, activeCodingTurn, routedIntent);
  if (directAnswer) {
    return directAnswer;
  }
  if (isGreetingText(normalized)) {
    return 'Hey. I can answer questions about recent activity, current setup, integrations, skills, and active work, or take a concrete task.';
  }
  if (/^(thanks|thank you|thx|appreciate it)$/.test(normalized)) {
    return 'You are welcome.';
  }
  if (/^(what can you do|who are you)$/.test(normalized)) {
    return [
      'I can summarize recent activity, report my current setup, inspect wired integrations, and take coding tasks.',
      'Try things like “what changed recently”, “what model are you running”, “what skills do you have installed”, or “what integrations are wired”.',
    ].join('\n');
  }
  return await generalQuestionReply(normalized, config, state, activeCodingTurn);
}

async function directQuestionReply(
  text: string,
  config: OpenKarenConfig,
  state: KarenStateClient,
  activeCodingTurn: ActiveCodingTurn | null,
  routedIntent: DirectQuestionIntent | 'general' | 'clarify' | null = null,
): Promise<string | null> {
  const intent = routedIntent && routedIntent !== 'general' && routedIntent !== 'clarify'
    ? routedIntent
    : classifyDirectQuestion(text);
  if (routedIntent === 'clarify') {
    return 'I can answer that, but I need a bit more shape. Ask about architecture, integrations, recent activity, current status, or give me a concrete task.';
  }

  if (routedIntent === 'general') {
    return await generalQuestionReply(text, config, state, activeCodingTurn);
  }

  if (!intent) {
    return null;
  }

  return await composeDirectQuestionReply(intent, config, state, activeCodingTurn);
}

async function routeQuestion(
  text: string,
  config: OpenKarenConfig,
  state: KarenStateClient,
  activeCodingTurn: ActiveCodingTurn | null,
): Promise<QuestionRoute> {
  if (!config.openaiApiKey || !config.questionRouterModel) {
    return fallbackQuestionRoute(text);
  }

  try {
    const packet = await buildLocalContextPacket(config, state, activeCodingTurn);
    const decision = await decideQuestionRoute(text, packet, config);
    if (decision) {
      return routeFromRouterDecision(decision, 'llm');
    }
  } catch (error) {
    console.warn('question-router: fell back to local heuristics', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  console.info('question-router: decided_by=fallback because LLM decision was unavailable');
  return fallbackQuestionRoute(text);
}

function routeFromRouterDecision(
  decision: QuestionRouterDecision,
  decidedBy: 'llm' | 'fallback',
): QuestionRoute {
  if (decision.route === 'coding_task') {
    return {
      kind: 'coding',
      intent: 'task',
      decidedBy,
      decisionRoute: decision.route,
      semanticIntent: decision.intent,
      reason: decision.reason,
    };
  }

  if (decision.route === 'clarify') {
    return {
      kind: 'chat',
      intent: 'clarify',
      decidedBy,
      decisionRoute: decision.route,
      semanticIntent: decision.intent,
      reason: decision.reason,
    };
  }

  return {
    kind: 'chat',
    intent: mapRouterIntentToDirectIntent(decision.intent),
    decidedBy,
    decisionRoute: decision.route,
    semanticIntent: decision.intent,
    reason: decision.reason,
  };
}

function fallbackQuestionRoute(text: string): QuestionRoute {
  const normalized = normalizeCasualText(text);
  const directIntent = classifyDirectQuestion(normalized);
  if (directIntent) {
    return routeFromRouterDecision(
      { route: 'direct_answer', intent: mapDirectIntentToRouterIntent(directIntent) },
      'fallback',
    );
  }

  const route = routeOpenKarenMessage(text);
  if (route.kind === 'coding') {
    return routeFromRouterDecision(
      { route: 'coding_task', reason: route.reason },
      'fallback',
    );
  }

  return {
    kind: 'chat',
    intent: null,
    decidedBy: 'fallback',
    decisionRoute: 'direct_answer',
    reason: 'fallback chat without direct semantic intent',
  };
}

function mapRouterIntentToDirectIntent(
  intent: QuestionRouterIntent | undefined,
): DirectQuestionIntent | 'general' {
  switch (intent) {
    case 'architecture':
      return 'architecture';
    case 'integration_status':
    case 'integration_assessment':
      return 'integrationDepth';
    case 'improvement_advice':
      return 'improvementAdvice';
    case 'runtime_status':
      return 'status';
    case 'recent_activity':
      return 'recentChanges';
    case 'capabilities':
      return 'capabilities';
    case 'skills_tools':
      return 'skills';
    case 'model_setup':
      return 'model';
    case 'general':
    default:
      return 'general';
  }
}

function mapDirectIntentToRouterIntent(intent: DirectQuestionIntent): QuestionRouterIntent {
  switch (intent) {
    case 'architecture':
      return 'architecture';
    case 'integrationDepth':
      return 'integration_assessment';
    case 'integrations':
      return 'integration_status';
    case 'improvementAdvice':
      return 'improvement_advice';
    case 'status':
      return 'runtime_status';
    case 'recentChanges':
      return 'recent_activity';
    case 'capabilities':
      return 'capabilities';
    case 'skills':
      return 'skills_tools';
    case 'model':
      return 'model_setup';
  }
}

function classifyDirectQuestion(text: string): DirectQuestionIntent | null {
  if (isRecentChangesQuestion(text)) {
    return 'recentChanges';
  }
  if (asksAboutArchitecture(text)) {
    return 'architecture';
  }
  if (asksAboutModel(text)) {
    return 'model';
  }
  if (asksAboutSkills(text)) {
    return 'skills';
  }
  if (asksAboutIntegrationDepth(text)) {
    return 'integrationDepth';
  }
  if (asksForImprovementAdvice(text)) {
    return 'improvementAdvice';
  }
  if (asksAboutIntegrations(text)) {
    return 'integrations';
  }
  if (asksAboutStatus(text)) {
    return 'status';
  }
  if (/^(what can you do|who are you)$/.test(text)) {
    return 'capabilities';
  }
  return null;
}

function asksAboutModel(text: string): boolean {
  return /\bwhat model\b/.test(text) ||
    /\bwhich model\b/.test(text) ||
    /\bmodel are you running\b/.test(text) ||
    /\bwhat are you running on\b/.test(text);
}

function asksAboutArchitecture(text: string): boolean {
  return /\bwhat exactly are you built on\b/.test(text) ||
    /\bwhat are you built on\b/.test(text) ||
    /\bhow are you built\b/.test(text) ||
    /\barchitecture\b/.test(text) ||
    /\bhow do you work\b/.test(text);
}

function asksAboutSkills(text: string): boolean {
  return /\bwhat skills\b/.test(text) ||
    /\bwhich skills\b/.test(text) ||
    /\bskills do you have\b/.test(text) ||
    /\bskills are installed\b/.test(text) ||
    /\binstalled skills\b/.test(text);
}

function asksAboutIntegrations(text: string): boolean {
  return /\bintegrations\b/.test(text) ||
    /\bwhat is wired\b/.test(text) ||
    /\bwhat's wired\b/.test(text) ||
    /\bwhat do you have connected\b/.test(text);
}

function asksAboutIntegrationDepth(text: string): boolean {
  return (/(how|what)\s+(fully|deeply|well|real)\s+integrated\b/.test(text) ||
    /\bintegration depth\b/.test(text) ||
    /\bhow real\b.*\bintegration\b/.test(text) ||
    /\bactually using relay\b/.test(text) ||
    /\bhow integrated\b/.test(text)) &&
    (/\bagent assistant\b/.test(text) || /\bagent-assistant\b/.test(text) || /\bsdk\b/.test(text) || /\brelay\b/.test(text));
}

function asksAboutStatus(text: string): boolean {
  return /\bwhat are you working on\b/.test(text) ||
    /\bwhat are you doing\b/.test(text) ||
    /\bcurrent status\b/.test(text) ||
    /\bstatus right now\b/.test(text);
}

function asksForImprovementAdvice(text: string): boolean {
  return /(how|what)\s+(can|should)\s+(we|i)\s+(improve|change|tighten|clean up)\b/.test(text) ||
    /\bhow do we make this (cleaner|better|more native|less hacked together)\b/.test(text) ||
    /\bwhat would make this feel (more real|more native|less hacked together)\b/.test(text) ||
    /\bnext step to (tighten|clean up|improve)\b/.test(text) ||
    /\bhow can we improve the integration\b/.test(text);
}

async function generalQuestionReply(
  _text: string,
  config: OpenKarenConfig,
  state: KarenStateClient,
  activeCodingTurn: ActiveCodingTurn | null,
): Promise<string> {
  const packet = await buildLocalContextPacket(config, state, activeCodingTurn);
  const facets = [
    packet.activeWork ? `- active work: ${packet.activeWork}` : '- active work: none right now',
    `- mode: ${config.agentMode}`,
    `- key wiring: ${packet.wiredIntegrations.join(', ') || 'no major integrations wired'}`,
    '- if you want a sharper answer, ask about architecture, integration depth, recent activity, or what to improve next',
  ];
  return ['Here is the quickest grounded read I can give from local context.', ...facets].join('\n');
}

async function composeDirectQuestionReply(
  intent: DirectQuestionIntent,
  config: OpenKarenConfig,
  state: KarenStateClient,
  activeCodingTurn: ActiveCodingTurn | null,
): Promise<string> {
  const packet = await buildLocalContextPacket(config, state, activeCodingTurn);
  const facets = selectFacetsForIntent(intent, packet, config, activeCodingTurn);
  const lead = leadLineForIntent(intent, config);
  return [lead, ...facets].filter(Boolean).join('\n');
}

function selectFacetsForIntent(
  intent: DirectQuestionIntent,
  packet: QuestionRouterContextPacket,
  config: OpenKarenConfig,
  activeCodingTurn: ActiveCodingTurn | null,
): string[] {
  switch (intent) {
    case 'architecture':
      return architectureFacets(config);
    case 'recentChanges':
      return recentActivityFacets(packet);
    case 'model':
      return packet.modeSummary;
    case 'skills':
      return packet.skillSummary;
    case 'integrations':
      return packet.integrationSummary;
    case 'integrationDepth':
      return integrationDepthFacets(config);
    case 'improvementAdvice':
      return improvementAdviceFacets(config);
    case 'status':
      return statusFacets(config, activeCodingTurn);
    case 'capabilities':
      return [
        'I can summarize recent activity, report the current setup, inspect wired integrations, and take coding tasks.',
        'Use /status, /integrations, /spend, or /forecast when you want the terse operational version.',
      ];
    default:
      return [];
  }
}

function leadLineForIntent(intent: DirectQuestionIntent, config: OpenKarenConfig): string {
  switch (intent) {
    case 'architecture':
      return 'OpenKaren is real, but it is still more app-shaped than product-clean.';
    case 'recentChanges':
      return 'Here is the quick read on recent activity.';
    case 'model':
      return config.agentMode === 'relay'
        ? 'I am currently running through a relay-backed coding path.'
        : 'Here is the current execution setup.';
    case 'skills':
      return 'Here is the useful local tool and capability picture right now.';
    case 'integrations':
      return 'Here is the current wiring snapshot.';
    case 'integrationDepth':
      return 'Agent-assistant is deeply integrated here, but not cleanly enough yet.';
    case 'improvementAdvice':
      return 'The biggest gap is not whether the integration is real. It is whether the behavior feels native instead of app-local.';
    case 'status':
      return 'Here is my current working state.';
    case 'capabilities':
      return 'Here is the short version.';
    default:
      return 'Here is what I have.';
  }
}

async function buildLocalContextPacket(
  config: OpenKarenConfig,
  state: KarenStateClient,
  activeCodingTurn: ActiveCodingTurn | null,
): Promise<QuestionRouterContextPacket> {
  const recent = await recentConversationSummary(state);
  const workflows = await workflowSummary(state);
  const wiredIntegrations = integrationStatuses(config)
    .filter((item) => ['relay', 'relayfile', 'relaycast', 'relaycron', 'slack'].includes(item.id) && item.state !== 'missing')
    .map((item) => item.label);

  return {
    activeWork: activeCodingTurn?.text ?? null,
    recentMessages: recent,
    pendingWorkflows: workflows,
    wiredIntegrations,
    repoSummary: recentRepoFacet(config),
    modeSummary: modelFacets(config),
    skillSummary: skillFacets(config),
    integrationSummary: integrationFacets(config),
  };
}

function architectureFacets(config: OpenKarenConfig): string[] {
  return [
    'The core runtime shell, sessions, and surface handling are genuinely owned by @agent-assistant/sdk, so this is not just branding over a custom bot.',
    config.agentMode === 'relay'
      ? `The coding path is also real: work goes through ${config.agentRelayCli} on the ${config.agentRelayWorkflow} relay workflow.`
      : config.agentMode === 'command'
        ? `The coding path is currently command-backed through ${config.agentCommand ?? 'an unset command path'}.`
        : 'The coding path is currently queue-shaped rather than live execution.',
    'Where it still feels less clean is the higher-level product behavior. A fair amount of answer shaping and orchestration still lives inside OpenKaren instead of disappearing behind more reusable primitives.',
    '- grounding: local context is built from durable state, recent conversation, workflow state, integrations, and repo signal when available',
  ];
}

function modelFacets(config: OpenKarenConfig): string[] {
  if (config.agentMode === 'relay') {
    return [
      `- mode: relay`,
      `- relay cli: ${config.agentRelayCli}`,
      `- workflow: ${config.agentRelayWorkflow}`,
      `- model selection: ${config.agentRelayModel ?? 'persona-selected per role'}`,
    ];
  }

  if (config.agentMode === 'command') {
    return [
      '- mode: command',
      `- command runner: ${config.agentCommand ?? 'unset'}`,
    ];
  }

  return [
    '- mode: queue',
    '- work is queued instead of executed directly',
  ];
}

function skillFacets(config: OpenKarenConfig): string[] {
  const tokenTools = integrationStatuses(config)
    .filter((item) => ['rtk', 'tilth', 'burn', 'wash', 'tokensave'].includes(item.id))
    .map((item) => `- ${item.label}: ${item.state}`);

  return [
    '- relay execution for coding work',
    '- workforce personas',
    '- relayfile context when mounted',
    '- relaycron scheduling when configured',
    '- relaycast and Slack surfaces when enabled',
    ...tokenTools,
    '- use /integrations for the full detail dump',
  ];
}

function integrationFacets(config: OpenKarenConfig): string[] {
  return integrationStatuses(config)
    .filter((item) => ['relay', 'relayfile', 'relaycast', 'relaycron', 'durable-state', 'slack', 'workforce', 'nango'].includes(item.id))
    .map((item) => `- ${item.label}: ${item.state}`)
    .concat('- use /integrations if you want the full detail dump');
}

function integrationDepthFacets(config: OpenKarenConfig): string[] {
  const statuses = integrationStatuses(config);
  const agentAssistant = statuses.find((item) => item.id === 'agent-assistant');
  const relay = statuses.find((item) => item.id === 'relay');
  const durableState = statuses.find((item) => item.id === 'durable-state');

  return [
    'It owns the runtime shell, sessions, traits, and surface handling, so the integration is operationally real, not cosmetic.',
    'The uneven part is the abstraction boundary. Some of the product judgment and orchestration still lives locally in OpenKaren instead of feeling like first-class assistant primitives.',
    `- runtime shell: ${agentAssistant?.detail ?? '@agent-assistant/sdk is present'}`,
    `- execution path: ${relay?.detail ?? 'agent-relay execution status unknown'}`,
    `- state layer: ${durableState?.detail ?? 'durable state status unknown'}`,
    '- practical read: substantial runtime ownership, but still somewhat app-local in higher-level behavior',
  ];
}

function improvementAdviceFacets(config: OpenKarenConfig): string[] {
  return [
    'I would tighten it in this order:',
    '1. move more non-coding answer behavior behind reusable assistant primitives instead of app-local reply composition',
    '2. make integration and advisory questions first-class semantic paths instead of letting them fall back toward generic summaries',
    '3. keep the relay path explicit in user-facing progress and completion language so coding work feels relay-native, not queue-shaped',
    '4. unify state, recent activity, and context summarization behind a cleaner shared surface so direct answers read like judgment instead of dumps',
    config.agentMode === 'relay'
      ? `5. preserve ${config.agentRelayCli} relay as the obvious primary execution path and keep fallback modes visibly secondary`
      : '5. make relay the obvious primary execution path and keep fallback modes visibly secondary',
  ];
}

function statusFacets(config: OpenKarenConfig, activeCodingTurn: ActiveCodingTurn | null): string[] {
  return [
    `- mode: ${config.agentMode}`,
    activeCodingTurn
      ? `- active work: ${activeCodingTurn.text}`
      : '- active work: none right now',
    config.agentMode === 'relay'
      ? `- relay path: ${config.agentRelayCli} using the ${config.agentRelayWorkflow} workflow`
      : config.agentMode === 'command'
        ? `- command path: ${config.agentCommand ?? 'unset'}`
        : '- queue mode is active',
    '- ask what changed recently if you want a recent activity summary',
  ];
}

function isRecentChangesQuestion(text: string): boolean {
  return /\b(what|which|show|summarize|tell me)\b/.test(text) &&
    /\b(recent|recently|latest|last)\b/.test(text) &&
    /\b(change|changes|changed|work|commits?)\b/.test(text);
}

async function recentChangesReply(
  config: OpenKarenConfig,
  state: KarenStateClient,
  activeCodingTurn: ActiveCodingTurn | null,
): Promise<string> {
  const packet = await buildLocalContextPacket(config, state, activeCodingTurn);
  const facets = recentActivityFacets(packet);
  return ['Here is the quick read on recent activity.', ...facets].join('\n');
}

function recentActivityFacets(packet: QuestionRouterContextPacket): string[] {
  const facets: string[] = [];

  facets.push(
    packet.activeWork
      ? `- active work: ${packet.activeWork}`
      : '- active work: nothing running right now',
  );

  if (packet.recentMessages.length === 0) {
    facets.push('- recent conversation: none stored yet');
  } else {
    facets.push(
      ...packet.recentMessages.slice(0, 4).map((message) =>
        `- recent ${message.role}: ${compact(message.text, 90)}`,
      ),
    );
  }

  facets.push(
    ...packet.pendingWorkflows.map((workflow) =>
      `- pending workflow: ${workflow.label} (${workflow.status})`,
    ),
  );

  if (packet.wiredIntegrations.length > 0) {
    facets.push(`- wired surfaces/tools in play: ${packet.wiredIntegrations.join(', ')}`);
  }

  if (packet.repoSummary) {
    facets.push(packet.repoSummary);
  }

  return facets.length > 0 ? facets : ['- I do not have enough recent state yet'];
}

async function recentConversationSummary(
  state: KarenStateClient,
): Promise<Array<{ role: string; text: string }>> {
  try {
    const recent = await state.searchMessages('');
    return recent.slice(-4).reverse().map((message) => ({
      role: message.role,
      text: message.text,
    }));
  } catch {
    return [];
  }
}

async function workflowSummary(
  state: KarenStateClient,
): Promise<Array<{ label: string; status: string }>> {
  try {
    const due = await state.dueWorkflows(Date.now());
    return due.slice(0, 2).map((workflow) => ({
      label: workflow.trigger ?? workflow.type,
      status: workflow.status,
    }));
  } catch {
    return [];
  }
}

function recentRepoFacet(config: OpenKarenConfig): string | null {
  try {
    const output = execFileSync(
      'git',
      ['log', '--date=relative', '--pretty=format:%h\t%cr\t%s', '-1'],
      {
        cwd: config.agentCwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();

    if (!output) {
      return null;
    }

    const [sha, when, subject] = output.split('\t');
    return `- latest repo commit, if repo context matters: ${sha} (${when}) ${subject}`;
  } catch {
    return null;
  }
}

function isGreetingText(text: string): boolean {
  return /^(good\s+)?(morning|afternoon|evening)(\s+karen)?$/.test(text) ||
    /^(hi|hey|hello|yo|sup|hiya|howdy|greetings|gm|gn)(\s+(karen|there|openkaren))?$/.test(text) ||
    /^(how are you|how's it going|how is it going|what's up|whats up|wassup|you around|are you around)(\s+karen)?$/.test(text);
}

function normalizeCasualText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}'\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 3)}...`
    : normalized;
}

function statusText(
  config: OpenKarenConfig,
  activeCodingTurn: ActiveCodingTurn | null,
): string {
  const lines = [
    'Status',
    `mode: ${config.agentMode}`,
    activeCodingTurn
      ? `active: yes (${activeCodingTurn.surfaceId}:${activeCodingTurn.targetId}, ${activeCodingTurn.startedAt})`
      : 'active: no',
    `cwd: ${config.agentCwd}`,
    `chats: ${config.telegramAllowedChatIds.size || 'all'}`,
    'integrations:',
    integrationStatusText(config),
  ];

  if (config.agentMode === 'relay') {
    lines.splice(
      2,
      0,
      `relay: ${config.agentRelayCli}`,
      `workflow: ${config.agentRelayWorkflow}`,
      `channel: ${config.agentRelayChannel}`,
    );
  }

  return lines.join('\n');
}

function startRelayProgressTimer(
  config: OpenKarenConfig,
  onProgress: () => Promise<void>,
): () => void {
  if (config.agentMode !== 'relay') {
    return () => {};
  }

  const timer = setInterval(() => {
    void onProgress().catch((error: unknown) => {
      console.error('OpenKaren relay progress update failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, config.agentRelayProgressIntervalMs);

  timer.unref?.();
  return () => clearInterval(timer);
}

function relayProgressText(activeCodingTurn: ActiveCodingTurn | null): string {
  if (!activeCodingTurn) {
    return 'Still working.';
  }

  const elapsedMs = Date.now() - Date.parse(activeCodingTurn.startedAt);
  const elapsedMinutes = Math.max(2, Math.floor(elapsedMs / 60_000));

  if (activeCodingTurn.mode === 'relay') {
    return `Still working. Relay execution has been in flight for about ${elapsedMinutes} minutes.`;
  }

  if (activeCodingTurn.mode === 'command') {
    return `Still working. The local command path has been running for about ${elapsedMinutes} minutes.`;
  }

  return `Still working. Queue mode is active and this turn has been pending for about ${elapsedMinutes} minutes.`;
}

async function runOpenKarenTurnWithHardTimeout(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
): Promise<AgentRunResult> {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutResult = new Promise<AgentRunResult>((resolve) => {
    timeout = setTimeout(() => {
      void shutdownOpenKarenRelaySessions().catch((error: unknown) => {
        console.warn('OpenKaren relay reset after hard timeout failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      resolve({
        text: [
          `Timed out after ${formatDuration(config.agentTimeoutMs)}.`,
          'I reset the relay session so Telegram does not sit there silently like a decorative brick.',
        ].join('\n'),
        exitCode: null,
        timedOut: true,
      });
    }, config.agentTimeoutMs);
    timeout.unref?.();
  });

  try {
    return await Promise.race([
      runOpenKarenTurn(config, turn).catch((error: unknown) => ({
        text: `OpenKaren turn failed: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: null,
        timedOut: false,
      })),
      timeoutResult,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 1) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  const seconds = Math.max(1, Math.round(ms / 1_000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

function surfaceFormatForProgress(turn: RelayCronProgressTurn): Record<string, unknown> {
  if (turn.surfaceId === TELEGRAM_SURFACE_ID) {
    return { chatId: turn.targetId };
  }

  return {};
}

function surfaceFormatForProactive(turn: RelayCronProactiveTurn): Record<string, unknown> {
  if (turn.surfaceId === TELEGRAM_SURFACE_ID) {
    return { chatId: turn.targetId };
  }

  return {};
}

function primaryTelegramTarget(
  config: OpenKarenConfig,
): { surfaceId: string; targetId: string } | null {
  if (config.telegramAllowedChatIds.size !== 1) {
    return null;
  }

  const [targetId] = [...config.telegramAllowedChatIds];
  return { surfaceId: TELEGRAM_SURFACE_ID, targetId };
}

function proactiveDevelopmentPrompt(scheduleName: string): string {
  if (scheduleName === 'daily-standup') {
    return [
      'Scheduled daily standup.',
      'Inspect OpenKaren repo state, queued inbox, and relayfile context if mounted.',
      'Make focused fixes only when clearly useful, then report the shortest useful status.',
    ].join(' ');
  }

  if (scheduleName === 'workflow-health-check') {
    return [
      'Scheduled workflow health check.',
      'Run the smallest relevant OpenKaren health checks and fix obvious breakage.',
      'Keep it cheap. Drama is not a test strategy.',
    ].join(' ');
  }

  return `Scheduled ${scheduleName}. Inspect OpenKaren and report anything that needs the user's attention.`;
}

function inboxDevelopmentPrompt(event: OpenKarenInboxEvent): string {
  return [
    `External inbox event from ${event.source}: ${event.text}`,
    'Inspect the event, relayfile context if mounted, and OpenKaren repo state only if relevant.',
    'Take the smallest useful action, then report what changed or what needs attention.',
  ].join(' ');
}

export const __test = {
  chatReplyText,
};
