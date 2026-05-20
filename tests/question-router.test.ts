import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenKaren } from '../src/assistant.js';
import { parseQuestionRouterDecision } from '../src/question-router.js';
import type { OpenKarenConfig, QuestionRouterDecision } from '../src/types.js';

assertDecision(
  parseQuestionRouterDecision('{"route":"direct_answer","intent":"architecture","reason":"architecture question"}'),
  {
    route: 'direct_answer',
    intent: 'architecture',
    reason: 'architecture question',
  },
  'direct answer decision',
);

assertDecision(
  parseQuestionRouterDecision('{"route":"direct_answer","intent":"improvement_advice","reason":"advice question"}'),
  {
    route: 'direct_answer',
    intent: 'improvement_advice',
    reason: 'advice question',
  },
  'improvement advice decision',
);

assertDecision(
  parseQuestionRouterDecision('{"route":"clarify","reason":"too vague"}'),
  {
    route: 'clarify',
    reason: 'too vague',
  },
  'clarify decision',
);

assertDecision(
  parseQuestionRouterDecision('{"route":"coding_task"}'),
  {
    route: 'coding_task',
  },
  'coding task decision',
);

assertEqual(
  parseQuestionRouterDecision('{"route":"direct_answer"}'),
  null,
  'direct answer without intent is rejected',
);

assertEqual(
  parseQuestionRouterDecision('{"route":"chat","intent":"what model"}'),
  null,
  'non-contract route is rejected',
);

assertEqual(
  parseQuestionRouterDecision('not json'),
  null,
  'invalid JSON is rejected',
);

await assertTelegramRouterScenario('/status', {
  routerDecision: {
    route: 'coding_task',
    reason: 'would be wrong if called',
  },
  verify(result) {
    if (result.routerRequests.length !== 0) {
      throw new Error(`Expected hard slash command to bypass router, got ${result.routerRequests.length} router calls`);
    }
    if (!String(result.sentMessages[0]?.text ?? '').includes('Status')) {
      throw new Error(`Expected /status reply, got: ${String(result.sentMessages[0]?.text)}`);
    }
  },
});

await assertTelegramRouterScenario('How is OpenKaren built?', {
  routerDecision: {
    route: 'direct_answer',
    intent: 'architecture',
    reason: 'architecture question',
  },
  verify(result) {
    if (result.routerRequests.length !== 1) {
      throw new Error(`Expected one router request, got ${result.routerRequests.length}`);
    }
    if (!String(result.sentMessages[0]?.text ?? '').includes('more app-shaped than product-clean')) {
      throw new Error(`Expected architecture reply, got: ${String(result.sentMessages[0]?.text)}`);
    }
    if (result.queuedItems.length !== 0) {
      throw new Error(`Expected no queued items, got ${result.queuedItems.length}`);
    }
  },
});

await assertTelegramRouterScenario('Fix the failing config test', {
  routerDecision: {
    route: 'coding_task',
    reason: 'concrete work request',
  },
  expectedMessages: 2,
  verify(result) {
    const ack = String(result.sentMessages[0]?.text ?? '');
    if (!/Checking the damage|I see the problem|This smells fixable|I will make it less wrong/.test(ack)) {
      throw new Error(`Expected coding acknowledgement, got: ${ack}`);
    }
    if (!String(result.sentMessages[1]?.text ?? '').startsWith('Queued for later execution.')) {
      throw new Error(`Expected queued confirmation, got: ${String(result.sentMessages[1]?.text)}`);
    }
    if (result.queuedItems.length !== 1 || result.queuedItems[0]?.text !== 'Fix the failing config test') {
      throw new Error(`Expected one queued item for work request, got: ${JSON.stringify(result.queuedItems)}`);
    }
  },
});

await assertTelegramRouterScenario('That thing?', {
  routerDecision: {
    route: 'clarify',
    reason: 'too vague',
  },
  verify(result) {
    const reply = String(result.sentMessages[0]?.text ?? '');
    if (!reply.includes('I can answer that')) {
      throw new Error(`Expected clarify reply, got: ${reply}`);
    }
    if (!reply.includes('architecture, integrations, recent activity, current status')) {
      throw new Error(`Expected helpful clarify facets, got: ${reply}`);
    }
    if (result.queuedItems.length !== 0) {
      throw new Error(`Expected no queued items for clarify reply, got ${result.queuedItems.length}`);
    }
  },
});

await assertTelegramRouterScenario('How fully integrated is agent assistant?', {
  routerEnabled: false,
  verify(result) {
    if (result.routerRequests.length !== 0) {
      throw new Error(`Expected no router requests when disabled, got ${result.routerRequests.length}`);
    }
    const reply = String(result.sentMessages[0]?.text ?? '');
    if (!reply.includes('deeply integrated here, but not cleanly enough yet') || !reply.includes('operationally real, not cosmetic')) {
      throw new Error(`Expected deterministic integration-depth fallback reply, got: ${reply}`);
    }
  },
});

await assertTelegramRouterScenario('How can we improve the integration?', {
  routerEnabled: false,
  verify(result) {
    if (result.routerRequests.length !== 0) {
      throw new Error(`Expected no router requests when disabled, got ${result.routerRequests.length}`);
    }
    const reply = String(result.sentMessages[0]?.text ?? '');
    if (!reply.includes('biggest gap is not whether the integration is real') || !reply.includes('I would tighten it in this order:')) {
      throw new Error(`Expected deterministic improvement advice reply, got: ${reply}`);
    }
  },
});

// /do <ambiguous-chat-like-body> must bypass the question router and enter
// the coding/queue path even though the body alone would classify as chat.
await assertTelegramRouterScenario('/do say hello', {
  routerDecision: {
    route: 'direct_answer',
    intent: 'general',
    reason: 'would be wrong if called',
  },
  expectedMessages: 2,
  verify(result) {
    if (result.routerRequests.length !== 0) {
      throw new Error(`Expected /do to bypass router, got ${result.routerRequests.length} router calls`);
    }
    const ack = String(result.sentMessages[0]?.text ?? '');
    if (!/Queue mode is on, so I am dropping it into the local execution inbox\./.test(ack)) {
      throw new Error(`Expected queue-mode coding acknowledgement for /do, got: ${ack}`);
    }
    const followup = String(result.sentMessages[1]?.text ?? '');
    if (!followup.startsWith('Queued for later execution.')) {
      throw new Error(`Expected queued confirmation after /do, got: ${followup}`);
    }
    if (result.queuedItems.length !== 1) {
      throw new Error(`Expected exactly one queued item from /do bypass, got ${result.queuedItems.length}`);
    }
    if (result.queuedItems[0]?.text !== 'say hello') {
      throw new Error(`Expected queued text to be the stripped /do body, got: ${JSON.stringify(result.queuedItems[0])}`);
    }
  },
});

// /help must stay compact (≤ 1500 chars) and mention each of the six topics
// the spec calls out, so first-run users see a one-screen mobile reply.
await assertTelegramRouterScenario('/help', {
  routerDecision: {
    route: 'coding_task',
    reason: 'would be wrong if called',
  },
  verify(result) {
    if (result.routerRequests.length !== 0) {
      throw new Error(`Expected /help to bypass router, got ${result.routerRequests.length} router calls`);
    }
    if (result.queuedItems.length !== 0) {
      throw new Error(`Expected no queued items for /help, got ${result.queuedItems.length}`);
    }
    const reply = String(result.sentMessages[0]?.text ?? '');
    if (reply.length > 1500) {
      throw new Error(`Expected /help body ≤ 1500 chars, got ${reply.length}`);
    }
    const topicChecks: Array<[string, RegExp]> = [
      ['what Karen can do', /can answer setup\/status questions and take coding work/i],
      ['how to ask for coding work', /\/do\s+<task>|Work:\s*say/i],
      ['how to ask status/setup questions', /\/status[^]*\/doctor[^]*\/integrations/i],
      ['how to open the dashboard', /Dashboard:\s*http/i],
      ['how to check token spend', /\/spend[^]*\/forecast/i],
      ['how to avoid accidental work', /casual chat[^]*stay chat-only/i],
    ];
    for (const [label, pattern] of topicChecks) {
      if (!pattern.test(reply)) {
        throw new Error(`Expected /help to cover topic "${label}", got: ${reply}`);
      }
    }
  },
});

await assertTelegramRouterScenario('/start', {
  routerDecision: {
    route: 'coding_task',
    reason: 'would be wrong if called',
  },
  verify(result) {
    if (result.routerRequests.length !== 0) {
      throw new Error(`Expected /start to bypass router, got ${result.routerRequests.length} router calls`);
    }
    if (result.queuedItems.length !== 0) {
      throw new Error(`Expected no queued items for /start, got ${result.queuedItems.length}`);
    }
    const reply = String(result.sentMessages[0]?.text ?? '');
    if (!reply.includes('OpenKaren can answer setup/status questions and take coding work.')) {
      throw new Error(`Expected first-run help for /start, got: ${reply}`);
    }
  },
});

await assertTelegramRouterScenario('/dashboard', {
  routerDecision: {
    route: 'coding_task',
    reason: 'would be wrong if called',
  },
  verify(result) {
    if (result.routerRequests.length !== 0) {
      throw new Error(`Expected /dashboard to bypass router, got ${result.routerRequests.length} router calls`);
    }
    if (result.queuedItems.length !== 0) {
      throw new Error(`Expected no queued items for /dashboard, got ${result.queuedItems.length}`);
    }
    const reply = String(result.sentMessages[0]?.text ?? '');
    if (!reply.includes('Dashboard: http://127.0.0.1:0/dashboard')) {
      throw new Error(`Expected local dashboard URL for /dashboard, got: ${reply}`);
    }
  },
});

await assertTelegramRouterScenario('/doctor', {
  routerDecision: {
    route: 'coding_task',
    reason: 'would be wrong if called',
  },
  verify(result) {
    if (result.routerRequests.length !== 0) {
      throw new Error(`Expected /doctor to bypass router, got ${result.routerRequests.length} router calls`);
    }
    if (result.queuedItems.length !== 0) {
      throw new Error(`Expected no queued items for /doctor, got ${result.queuedItems.length}`);
    }
    const reply = String(result.sentMessages[0]?.text ?? '');
    if (!/^Doctor: /m.test(reply) || !/checks: \d+; failures: \d+; warnings: \d+/.test(reply)) {
      throw new Error(`Expected compact doctor summary for /doctor, got: ${reply}`);
    }
  },
});

console.log('question router runtime ok');

if (process.env.VITEST === 'true') {
  const vitest = await import('vitest');
  vitest.test('question-router runtime', () => {});
}

type RouterScenarioOptions = {
  routerDecision?: QuestionRouterDecision;
  routerEnabled?: boolean;
  expectedMessages?: number;
  verify: (result: {
    sentMessages: TelegramPayload[];
    routerRequests: unknown[];
    queuedItems: Array<{ text?: string }>;
  }) => void;
};

type TelegramPayload = {
  chat_id?: number | string;
  text?: string;
};

async function assertTelegramRouterScenario(text: string, options: RouterScenarioOptions): Promise<void> {
  const result = await runTelegramRouterScenario(text, options);
  options.verify(result);
}

async function runTelegramRouterScenario(
  text: string,
  options: Omit<RouterScenarioOptions, 'verify'>,
): Promise<{
  sentMessages: TelegramPayload[];
  routerRequests: unknown[];
  queuedItems: Array<{ text?: string }>;
}> {
  const originalFetch = globalThis.fetch;
  const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-router-runtime-'));
  const sentMessages: TelegramPayload[] = [];
  const routerRequests: unknown[] = [];
  let getUpdatesCalls = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

    if (url === 'https://api.openai.com/v1/responses') {
      routerRequests.push(JSON.parse(String(init?.body ?? '{}')) as unknown);
      return jsonResponse({
        output_text: JSON.stringify(options.routerDecision ?? {
          route: 'direct_answer',
          intent: 'general',
        }),
      });
    }

    const telegramMatch = url.match(/^http:\/\/telegram\.local\/bot([^/]+)\/([^/]+)$/);
    if (!telegramMatch) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }

    const [, token, method] = telegramMatch;
    if (token !== 'test-token') {
      throw new Error(`Unexpected Telegram token: ${token}`);
    }

    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;

    if (method === 'setMyCommands') {
      return jsonResponse({ ok: true, result: true });
    }

    if (method === 'getUpdates') {
      getUpdatesCalls += 1;
      return jsonResponse({
        ok: true,
        result: getUpdatesCalls === 1 ? [telegramUpdate(text)] : [],
      });
    }

    if (method === 'sendMessage') {
      sentMessages.push(body);
      return jsonResponse({
        ok: true,
        result: {
          message_id: 1000 + sentMessages.length,
          chat: { id: body.chat_id },
          text: body.text,
        },
      });
    }

    throw new Error(`Unexpected Telegram method: ${method}`);
  }) as typeof fetch;

  const runtime = createOpenKaren(testConfig(dataDir, options.routerEnabled !== false));
  const running = runtime.start();

  try {
    await waitFor(() => sentMessages.length >= (options.expectedMessages ?? 1), 10_000);
    await runtime.stop();
    await Promise.race([
      running,
      sleep(2_000).then(() => {
        throw new Error('OpenKaren runtime did not stop cleanly');
      }),
    ]);

    return {
      sentMessages,
      routerRequests,
      queuedItems: await readQueuedItems(dataDir),
    };
  } finally {
    await runtime.stop().catch(() => {});
    globalThis.fetch = originalFetch;
    await rm(dataDir, { recursive: true, force: true });
  }
}

function testConfig(dataDir: string, routerEnabled: boolean): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://telegram.local',
    telegramAllowedChatIds: new Set(['4242']),
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
    agentMode: 'queue',
    agentCommand: null,
    agentCwd: process.cwd(),
    agentTimeoutMs: 5_000,
    agentRelayCli: 'codex',
    agentRelayModel: null,
    agentRelayChannel: 'openkaren-dev',
    agentRelayWorkflow: 'orchestrated',
    agentRelayNamePrefix: 'OpenKarenCoder',
    agentRelayIdleThresholdSecs: 20,
    agentRelayProgressIntervalMs: 120_000,
    questionRouterModel: routerEnabled ? 'gpt-test-router' : null,
    openaiApiKey: routerEnabled ? 'sk-test' : null,
    dataDir,
    pollTimeoutSeconds: 1,
  };
}

function telegramUpdate(text: string): Record<string, unknown> {
  return {
    update_id: 200,
    message: {
      message_id: 300,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: 4242,
        type: 'private',
      },
      from: {
        id: 99,
        is_bot: false,
      },
      text,
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function readQueuedItems(dataDir: string): Promise<Array<{ text?: string }>> {
  const inboxDir = join(dataDir, 'inbox');
  const entries = await readdir(inboxDir).catch(() => []);
  return await Promise.all(
    entries.map(async (entry) =>
      JSON.parse(await readFile(join(inboxDir, entry), 'utf8')) as { text?: string },
    ),
  );
}

async function waitFor(assertion: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await sleep(50);
  }

  throw new Error('Timed out waiting for OpenKaren router runtime condition');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertDecision<T>(actual: T, expected: T, label: string): void {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${label} ${String(expected)}, got ${String(actual)}`);
  }
}
