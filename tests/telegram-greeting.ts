import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenKaren } from '../src/assistant.js';

const chatId = 515151;
const sentMessages: Record<string, unknown>[] = [];
const registeredCommands: Array<Record<string, unknown>> = [];
let getUpdatesCalls = 0;

const server = createServer(async (request, response) => {
  try {
    await handleTelegramRequest(request, response);
  } catch (error) {
    response.statusCode = 500;
    response.end(JSON.stringify({ ok: false, description: String(error) }));
  }
});

await new Promise<void>((resolve) => {
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Expected local HTTP server address');
}

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-telegram-greeting-'));
const runtime = createOpenKaren({
  telegramBotToken: 'greeting-token',
  telegramApiBaseUrl: `http://127.0.0.1:${address.port}`,
  telegramAllowedChatIds: new Set([String(chatId)]),
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
  workforcePersonaDir: join(process.cwd(), '../workforce/personas'),
  workforceRoutingProfile: join(
    process.cwd(),
    '../workforce/packages/workload-router/routing-profiles/default.json',
  ),
  nangoBaseUrl: null,
  nangoSecretKey: null,
  nangoWebhookPath: '/webhooks/nango',
  rtkCommand: 'rtk',
  tilthCommand: 'tilth',
  burnCommand: 'burn-missing-for-greeting-test',
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
  await sleep(250);
  await runtime.stop();
  await Promise.race([
    running,
    sleep(2_000).then(() => {
      throw new Error('OpenKaren Telegram runtime did not stop cleanly');
    }),
  ]);

  if (registeredCommands.length !== 1) {
    throw new Error(`Expected one setMyCommands call, got ${registeredCommands.length}`);
  }
  const commands = registeredCommands[0].commands;
  if (!Array.isArray(commands) || commands.length < 5) {
    throw new Error(`Expected registered Telegram commands, got ${JSON.stringify(registeredCommands[0])}`);
  }

  if (sentMessages.length !== 2) {
    throw new Error(`Expected two chat responses, got ${sentMessages.length}`);
  }
  if (sentMessages[0].text !== 'Hey. I can answer questions about recent activity, current setup, integrations, skills, and active work, or take a concrete task.') {
    throw new Error(`Unexpected greeting response: ${String(sentMessages[0].text)}`);
  }
  if (
    typeof sentMessages[0].text === 'string' &&
    sentMessages[0].text.includes('best quick read I can give from local context')
  ) {
    throw new Error(`Greeting fell through to generalized context reply: ${String(sentMessages[0].text)}`);
  }
  if (
    typeof sentMessages[1].text !== 'string' ||
    !sentMessages[1].text.includes('best quick read I can give from local context') ||
    !sentMessages[1].text.includes('- key wiring:')
  ) {
    throw new Error(`Unexpected vague-chat fallback response: ${String(sentMessages[1].text)}`);
  }

  const inboxDir = join(dataDir, 'inbox');
  const queued = existsSync(inboxDir) ? await readdir(inboxDir) : [];
  if (queued.length !== 0) {
    throw new Error(`Expected greeting not to queue relay work, found ${queued.length} inbox items`);
  }

  console.log('telegram greeting ok');
} finally {
  await runtime.stop().catch(() => {});
  server.close();
  await rm(dataDir, { recursive: true, force: true });
}

async function handleTelegramRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const match = request.url?.match(/^\/bot([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Unexpected Telegram path: ${request.url}`);
  }
  const [, token, method] = match;
  if (token !== 'greeting-token') {
    throw new Error(`Unexpected token: ${token}`);
  }
  if (method === 'setMyCommands') {
    registeredCommands.push(JSON.parse(await readBody(request)) as Record<string, unknown>);
    sendJson(response, { ok: true, result: true });
    return;
  }
  if (method === 'getUpdates') {
    getUpdatesCalls += 1;
    sendJson(response, {
      ok: true,
      result: getUpdatesCalls === 1 ? telegramUpdates() : [],
    });
    return;
  }
  if (method === 'sendMessage') {
    sentMessages.push(JSON.parse(await readBody(request)) as Record<string, unknown>);
    sendJson(response, { ok: true, result: { message_id: 1 } });
    return;
  }
  throw new Error(`Unexpected Telegram method: ${method}`);
}

function telegramUpdates(): Array<Record<string, unknown>> {
  return [
    {
      update_id: 10,
      message: {
        message_id: 20,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: 99, is_bot: false, first_name: 'Test' },
        text: 'good morning Karen!',
      },
    },
    {
      update_id: 11,
      message: {
        message_id: 21,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        from: { id: 99, is_bot: false, first_name: 'Test' },
        text: 'Yo yo',
      },
    },
  ];
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
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

async function waitFor(assertion: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (assertion()) return;
    await sleep(25);
  }
  throw new Error('Timed out waiting for greeting response');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
