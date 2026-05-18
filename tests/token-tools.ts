import { readFile } from 'node:fs/promises';
import { rtkStatus, tokenToolsPrompt } from '../src/token-tools.js';
import type { OpenKarenConfig } from '../src/types.js';

const wrongRtk = rtkStatus('definitely-not-openkaren-rtk');
if (wrongRtk.state !== 'missing' || !wrongRtk.detail.includes('Rust Token Killer')) {
  throw new Error(`Expected missing RTK to mention Rust Token Killer, got ${JSON.stringify(wrongRtk)}`);
}

const prompt = tokenToolsPrompt(testConfig());
if (!prompt.includes('Token tool policy:') || !prompt.includes('Tilth') || !prompt.includes('TokenSave')) {
  throw new Error(`Expected token tool prompt to describe RTK, Tilth, and TokenSave: ${prompt}`);
}

const mcp = JSON.parse(await readFile('.mcp.json', 'utf8')) as {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
};

if (mcp.mcpServers?.tilth?.command !== 'node' || !mcp.mcpServers.tilth.args?.includes('--mcp')) {
  throw new Error(`Expected Tilth MCP server in .mcp.json, got ${JSON.stringify(mcp.mcpServers?.tilth)}`);
}

if (mcp.mcpServers?.tokensave?.command !== 'tokensave' || !mcp.mcpServers.tokensave.args?.includes('serve')) {
  throw new Error(`Expected TokenSave MCP server in .mcp.json, got ${JSON.stringify(mcp.mcpServers?.tokensave)}`);
}

console.log('token tools ok');

function testConfig(): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['1']),
    relaycastEnabled: false,
    relaycastHost: '127.0.0.1',
    relaycastPort: 3789,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir: 'relayfile-mount',
    relayfileWorkspace: 'openkaren',
    relayfileBaseUrl: null,
    relayfileToken: null,
    relaycronBaseUrl: null,
    relaycronApiKey: null,
    relaycronWebhookUrl: null,
    dashboardEnabled: true,
    dashboardPath: '/dashboard',
    stateWorkerUrl: null,
    stateWorkerAuthToken: null,
    stateUserId: 'local',
    slackEnabled: false,
    slackSigningSecret: null,
    slackAllowedChannelIds: new Set(),
    slackBotToken: null,
    slackWebhookPath: '/webhooks/slack',
    workforcePersonaDir: '../workforce/personas',
    workforceRoutingProfile: '../workforce/packages/workload-router/routing-profiles/default.json',
    nangoBaseUrl: null,
    nangoSecretKey: null,
    nangoWebhookPath: '/webhooks/nango',
    rtkCommand: 'definitely-not-openkaren-rtk',
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
    dataDir: '.openkaren-test',
    pollTimeoutSeconds: 1,
  };
}
