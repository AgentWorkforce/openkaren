import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenKaren } from '../src/assistant.js';

type TelegramRequest = {
  method: string;
  body: Record<string, unknown>;
};

const chatId = 424242;
const sentMessages: Record<string, unknown>[] = [];
const requests: TelegramRequest[] = [];

let getUpdatesCalls = 0;

const server = createServer(async (request, response) => {
  try {
    await handleTelegramRequest(request, response);
  } catch (error) {
    response.statusCode = 500;
    response.end(
      JSON.stringify({
        ok: false,
        description: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Expected local HTTP server address');
}

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-telegram-e2e-'));
const runtime = createOpenKaren({
  telegramBotToken: 'e2e-token',
  telegramApiBaseUrl: `http://127.0.0.1:${address.port}`,
  telegramAllowedChatIds: new Set([String(chatId)]),
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
  workforcePersonaDir: join(process.cwd(), '../workforce/personas'),
  workforceRoutingProfile: join(
    process.cwd(),
    '../workforce/packages/workload-router/routing-profiles/default.json',
  ),
  nangoBaseUrl: null,
  nangoSecretKey: null,
  rtkCommand: 'rtk',
  tilthCommand: 'tilth',
  burnCommand: 'burn-missing-for-e2e',
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
  questionRouterModel: null,
  openaiApiKey: null,
  dataDir,
  pollTimeoutSeconds: 1,
});

const running = runtime.start();

try {
  await waitFor(() => sentMessages.length >= 2, 5_000);
  await runtime.stop();
  await Promise.race([
    running,
    sleep(2_000).then(() => {
      throw new Error('OpenKaren Telegram runtime did not stop cleanly');
    }),
  ]);

  assertTelegramFlow();
  await assertQueuedInboxItem(dataDir);
  console.log('telegram e2e ok');
} finally {
  await runtime.stop().catch(() => {});
  server.close();
  await rm(dataDir, { recursive: true, force: true });
}

async function handleTelegramRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    throw new Error(`Unexpected method: ${request.method}`);
  }

  const match = request.url?.match(/^\/bot([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Unexpected Telegram path: ${request.url}`);
  }

  const [, token, method] = match;
  if (token !== 'e2e-token') {
    throw new Error(`Unexpected token: ${token}`);
  }

  const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
  requests.push({ method, body });

  if (method === 'setMyCommands') {
    sendJson(response, {
      ok: true,
      result: true,
    });
    return;
  }

  if (method === 'getUpdates') {
    getUpdatesCalls += 1;
    sendJson(response, {
      ok: true,
      result: getUpdatesCalls === 1 ? [telegramUpdate()] : [],
    });
    return;
  }

  if (method === 'sendMessage') {
    sentMessages.push(body);
    sendJson(response, {
      ok: true,
      result: {
        message_id: 9000 + sentMessages.length,
        chat: { id: body.chat_id },
        text: body.text,
      },
    });
    return;
  }

  throw new Error(`Unexpected Telegram method: ${method}`);
}

function assertTelegramFlow(): void {
  const commandRegistration = requests.find((request) => request.method === 'setMyCommands');
  if (!commandRegistration) {
    throw new Error('Expected OpenKaren to register Telegram commands');
  }
  if (!Array.isArray(commandRegistration.body.commands) || commandRegistration.body.commands.length < 6) {
    throw new Error(`Expected Telegram commands payload, got ${JSON.stringify(commandRegistration.body)}`);
  }
  if (!(commandRegistration.body.commands as Array<{ command?: string }>).some((entry) => entry.command === 'do')) {
    throw new Error(`Expected /do Telegram command registration, got ${JSON.stringify(commandRegistration.body)}`);
  }

  const firstPoll = requests.find((request) => request.method === 'getUpdates');
  if (!firstPoll) {
    throw new Error('Expected OpenKaren to poll getUpdates');
  }

  if (firstPoll.body.offset !== 0) {
    throw new Error(`Expected first getUpdates offset 0, got ${firstPoll.body.offset}`);
  }

  const firstMessage = sentMessages[0];
  const secondMessage = sentMessages[1];

  if (String(firstMessage.chat_id) !== String(chatId)) {
    throw new Error(`Expected first sendMessage chat_id ${chatId}`);
  }

  if (
    typeof firstMessage.text !== 'string' ||
    ![
      'On it.',
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
    ].includes(firstMessage.text)
  ) {
    throw new Error(`Unexpected first Telegram response: ${String(firstMessage.text)}`);
  }

  if (String(secondMessage.chat_id) !== String(chatId)) {
    throw new Error(`Expected second sendMessage chat_id ${chatId}`);
  }

  if (
    typeof secondMessage.text !== 'string' ||
    !secondMessage.text.startsWith('Queued.')
  ) {
    throw new Error(`Unexpected queued response: ${String(secondMessage.text)}`);
  }
}

async function assertQueuedInboxItem(dataDir: string): Promise<void> {
  const inboxDir = join(dataDir, 'inbox');
  const entries = await readdir(inboxDir);
  if (entries.length !== 1) {
    throw new Error(`Expected one queued inbox item, found ${entries.length}`);
  }

  const body = JSON.parse(await readFile(join(inboxDir, entries[0]), 'utf8')) as {
    chatId?: string;
    text?: string;
  };

  if (body.chatId !== String(chatId)) {
    throw new Error(`Expected queued chatId ${chatId}, got ${body.chatId}`);
  }

  if (body.text !== 'Build yourself through Telegram') {
    throw new Error(`Unexpected queued text: ${String(body.text)}`);
  }
}

function telegramUpdate(): Record<string, unknown> {
  return {
    update_id: 100,
    message: {
      message_id: 200,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: chatId,
        type: 'private',
        username: 'khaliqgant',
      },
      from: {
        id: 777,
        is_bot: false,
        username: 'khaliqgant',
        first_name: 'Khaliq',
      },
      text: '/do Build yourself through Telegram',
    },
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function waitFor(assertion: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) {
      return;
    }
    await sleep(25);
  }

  throw new Error('Timed out waiting for Telegram E2E condition');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
