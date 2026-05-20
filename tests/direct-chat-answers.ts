import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenKaren, statusText } from '../src/assistant.js';

const dataDir = await mkdtemp(join(tmpdir(), 'openkaren-direct-chat-'));

try {
  const config = {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['1']),
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
    identityBridgeMappings: new Map([['telegram:1', 'person-1']]),
    slackEnabled: false,
    slackSigningSecret: null,
    slackAllowedChannelIds: new Set(),
    slackBotToken: null,
    slackWebhookPath: '/webhooks/slack',
    workforcePersonaDir: join(process.cwd(), '../workforce/personas'),
    workforceRoutingProfile: join(process.cwd(), '../workforce/packages/workload-router/routing-profiles/default.json'),
    nangoBaseUrl: null,
    nangoSecretKey: null,
    nangoWebhookPath: '/webhooks/nango',
    rtkCommand: 'rtk',
    tilthCommand: 'tilth',
    burnCommand: 'burn',
    washCommand: 'wash',
    tokensaveCommand: 'tokensave',
    monthlyBudgetUsd: 75,
    agentMode: 'relay' as const,
    agentCommand: null,
    agentCwd: process.cwd(),
    agentTimeoutMs: 5_000,
    agentRelayCli: 'codex',
    agentRelayModel: null,
    agentRelayChannel: 'openkaren-dev',
    agentRelayWorkflow: 'orchestrated' as const,
    agentRelayNamePrefix: 'OpenKarenCoder',
    agentRelayIdleThresholdSecs: 20,
    agentRelayProgressIntervalMs: 120_000,
    questionRouterModel: null,
    openaiApiKey: null,
    dataDir,
    pollTimeoutSeconds: 1,
  };

  const runtime = createOpenKaren(config);
  void runtime;

  const module = await import('../src/assistant.js');
  const chatReply = (module as unknown as { __test?: { chatReplyText?: (text: string, config: typeof config, state: { searchMessages(query: string): Promise<unknown[]>; dueWorkflows(now?: number): Promise<Array<{ trigger?: string; type: string; status: string }>> }, activeCodingTurn: null) => Promise<string> } }).__test?.chatReplyText;
  if (!chatReply) {
    throw new Error('Expected assistant test hook for chatReplyText');
  }

  const mockState = {
    async searchMessages(): Promise<unknown[]> {
      return [
        { role: 'user', text: 'What changed recently?' },
        { role: 'assistant', text: 'Here is the quick read on recent activity.' },
      ];
    },
    async dueWorkflows(): Promise<Array<{ trigger?: string; type: string; status: string }>> {
      return [{ trigger: 'daily-standup', type: 'scheduled', status: 'pending' }];
    },
  };

  const modelReply = await chatReply('What model are you running?', config, mockState, null);
  if (!modelReply.includes('running through a relay-backed coding path') || !modelReply.includes('- relay cli: codex')) {
    throw new Error(`Expected model reply to mention current model facets, got: ${modelReply}`);
  }

  const skillsReply = await chatReply('What skills do you have installed?', config, mockState, null);
  if (!skillsReply.includes('useful local tool and capability picture') || !skillsReply.includes('- rtk:')) {
    throw new Error(`Expected skills reply to mention installed capabilities, got: ${skillsReply}`);
  }

  const fallbackReply = await chatReply('Yo yo', config, mockState, null);
  if (!fallbackReply.includes('quick read I can give from local context') || !fallbackReply.includes('- key wiring:')) {
    throw new Error(`Expected generalized local-context reply, got: ${fallbackReply}`);
  }

  const capabilitiesReply = await chatReply('What can you do', config, mockState, null);
  if (!capabilitiesReply.includes('Here is the short version.') || !capabilitiesReply.includes('summarize recent activity')) {
    throw new Error(`Expected capabilities reply to be composed from facets, got: ${capabilitiesReply}`);
  }

  const status = statusText({ ...config, slackEnabled: true }, null);
  if (
    !status.includes('active surfaces: telegram, slack') ||
    !status.includes('bridge mode: explicit mapping') ||
    !status.includes('state backend: local in-memory fallback')
  ) {
    throw new Error(`Expected /status active surfaces, bridge mode, and state backend, got: ${status}`);
  }

  const workerStatus = statusText({ ...config, stateWorkerUrl: 'https://state.example', stateWorkerAuthToken: null }, null);
  if (!workerStatus.includes('state backend: worker (https://state.example, auth missing)')) {
    throw new Error(`Expected worker-backed status text, got: ${workerStatus}`);
  }

  const recentReply = await chatReply('What changed recently?', config, mockState, null);
  if (!recentReply.includes('recent assistant: Here is the quick read on recent activity.') || !recentReply.includes('pending workflow: daily-standup')) {
    throw new Error(`Expected recent activity reply to include assistant/workflow context, got: ${recentReply}`);
  }

  const integrationDepthReply = await chatReply('How fully integrated is agent assistant?', config, mockState, null);
  if (!integrationDepthReply.includes('deeply integrated here, but not cleanly enough yet') || !integrationDepthReply.includes('operationally real, not cosmetic')) {
    throw new Error(`Expected integration-depth reply for agent-assistant, got: ${integrationDepthReply}`);
  }

  const improvementReply = await chatReply('How can we improve the integration?', config, mockState, null);
  if (!improvementReply.includes('biggest gap is not whether the integration is real') || !improvementReply.includes('I would tighten it in this order:')) {
    throw new Error(`Expected improvement advice reply, got: ${improvementReply}`);
  }

  console.log('direct chat answers ok');
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
