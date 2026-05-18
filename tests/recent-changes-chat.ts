import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createOpenKaren } from '../src/assistant.js';

const chatId = 616161;
const sentMessages: Record<string, unknown>[] = [];
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

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-recent-changes-'));
const repoDir = await mkdtemp(join(tmpdir(), 'openkaren-recent-changes-repo-'));
const originalCwd = process.cwd();
process.chdir(repoDir);

execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'OpenKaren Test'], { cwd: repoDir, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'openkaren@example.com'], { cwd: repoDir, stdio: 'ignore' });
await writeFile(join(repoDir, 'README.md'), '# test\n');
execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'Initial test commit'], { cwd: repoDir, stdio: 'ignore' });

const runtime = createOpenKaren({
  telegramBotToken: 'recent-token',
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
  workforcePersonaDir: join(originalCwd, '../workforce/personas'),
  workforceRoutingProfile: join(
    originalCwd,
    '../workforce/packages/workload-router/routing-profiles/default.json',
  ),
  nangoBaseUrl: null,
  nangoSecretKey: null,
  nangoWebhookPath: '/webhooks/nango',
  rtkCommand: 'rtk',
  tilthCommand: 'tilth',
  burnCommand: 'burn-missing-for-recent-test',
  washCommand: 'wash',
  tokensaveCommand: 'tokensave',
  monthlyBudgetUsd: 75,
  agentMode: 'queue',
  agentCommand: null,
  agentCwd: repoDir,
  agentTimeoutMs: 5_000,
  agentRelayCli: 'codex',
  agentRelayModel: null,
  agentRelayChannel: 'openkaren-dev',
  agentRelayWorkflow: 'orchestrated',
  agentRelayNamePrefix: 'OpenKarenCoder',
  agentRelayIdleThresholdSecs: 20,
  agentRelayProgressIntervalMs: 120_000,
  dataDir,
  pollTimeoutSeconds: 1,
});

const running = runtime.start();

try {
  await waitFor(() => sentMessages.length >= 1, 5_000);
  await sleep(250);
  await runtime.stop();
  await Promise.race([
    running,
    sleep(2_000).then(() => {
      throw new Error('OpenKaren recent-changes runtime did not stop cleanly');
    }),
  ]);

  if (sentMessages.length !== 1) {
    throw new Error(`Expected one recent-changes response, got ${sentMessages.length}`);
  }

  const text = String(sentMessages[0].text ?? '');
  if (!text.includes('Here is the quick read on recent activity.')) {
    throw new Error(`Expected recent activity header, got: ${text}`);
  }
  if (!text.includes('recent user: What changes have been made recently')) {
    throw new Error(`Expected recent conversation summary in response, got: ${text}`);
  }
  if (!text.includes('Initial test commit')) {
    throw new Error(`Expected optional repo context in response, got: ${text}`);
  }

  const inboxDir = join(dataDir, 'inbox');
  const queued = existsSync(inboxDir) ? await readdir(inboxDir) : [];
  if (queued.length !== 0) {
    throw new Error(`Expected recent-changes query not to queue relay work, found ${queued.length} inbox items`);
  }

  console.log('recent changes chat ok');
} finally {
  process.chdir(originalCwd);
  await runtime.stop().catch(() => {});
  server.close();
  await rm(dataDir, { recursive: true, force: true });
  await rm(repoDir, { recursive: true, force: true });
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
  if (token !== 'recent-token') {
    throw new Error(`Unexpected token: ${token}`);
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
    sentMessages.push(JSON.parse(await readBody(request)) as Record<string, unknown>);
    sendJson(response, { ok: true, result: { message_id: 1 } });
    return;
  }
  throw new Error(`Unexpected Telegram method: ${method}`);
}

function telegramUpdate(): Record<string, unknown> {
  return {
    update_id: 30,
    message: {
      message_id: 40,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      from: { id: 99, is_bot: false, first_name: 'Test' },
      text: 'What changes have been made recently?',
    },
  };
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
  throw new Error('Timed out waiting for recent-changes response');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
