import { join } from 'node:path';
import { createOpenKarenRicky, isRickySdkAvailable } from '../src/ricky.js';
import type { OpenKarenConfig } from '../src/types.js';

if (!isRickySdkAvailable()) {
  throw new Error('Expected @agentworkforce/ricky SDK to be importable');
}

const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
const ricky = createOpenKarenRicky(testConfig('/workspace/openkaren'), {
  sdk: {
    async generateLocalWorkflow(input) {
      calls.push({ method: 'generateLocalWorkflow', input });
      return { status: 'success', message: 'generated' } as never;
    },
    async runLocalWorkflow(input) {
      calls.push({ method: 'runLocalWorkflow', input });
      return { status: 'success', message: 'ran' } as never;
    },
  },
});

await ricky.generateLocalWorkflow({
  spec: 'Generate a workflow that checks package health',
  workflowName: 'package-health',
});

await ricky.runLocalWorkflow({
  workflowPath: 'workflows/generated/package-health.ts',
  autoFixAttempts: 3,
});

assertEqual(calls[0]?.method, 'generateLocalWorkflow', 'generate method');
assertEqual(calls[0]?.input.cwd, '/workspace/openkaren', 'generate default cwd');
assertEqual(calls[0]?.input.workflowName, 'package-health', 'generate workflow name');
assertEqual(calls[1]?.method, 'runLocalWorkflow', 'run method');
assertEqual(calls[1]?.input.cwd, '/workspace/openkaren', 'run default cwd');
assertEqual(calls[1]?.input.autoFixAttempts, 3, 'run auto-fix attempts');

console.log('ricky sdk ok');

function testConfig(agentCwd: string): OpenKarenConfig {
  return {
    telegramBotToken: 'test-token',
    telegramApiBaseUrl: 'http://127.0.0.1',
    telegramAllowedChatIds: new Set(['1']),
    relaycastEnabled: false,
    relaycastHost: '127.0.0.1',
    relaycastPort: 7528,
    relaycastWebhookPath: '/webhooks/relaycast',
    relaycastWebhookSecret: null,
    relayfileMountDir: join(agentCwd, 'relayfile-mount'),
    relayfileWorkspace: 'openkaren',
    relayfileBaseUrl: null,
    relayfileToken: null,
    relaycronBaseUrl: null,
    relaycronApiKey: null,
    relaycronWebhookUrl: null,
    workforcePersonaDir: join(agentCwd, '../workforce/personas'),
    workforceRoutingProfile: join(
      agentCwd,
      '../workforce/packages/workload-router/routing-profiles/default.json',
    ),
    nangoBaseUrl: null,
    nangoSecretKey: null,
    rtkCommand: 'rtk',
    tilthCommand: 'tilth',
    burnCommand: 'burn',
    washCommand: 'wash',
    tokensaveCommand: 'tokensave',
    monthlyBudgetUsd: 75,
    agentMode: 'relay',
    agentCommand: null,
    agentCwd,
    agentTimeoutMs: 5_000,
    agentRelayCli: 'codex',
    agentRelayModel: null,
    agentRelayChannel: 'openkaren-dev',
    agentRelayWorkflow: 'orchestrated',
    agentRelayNamePrefix: 'OpenKarenCoder',
    agentRelayIdleThresholdSecs: 1,
    agentRelayProgressIntervalMs: 120_000,
    dataDir: join(agentCwd, '.openkaren-test'),
    pollTimeoutSeconds: 1,
  };
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
