import { normalizeNangoWebhook } from '../src/nango.js';
import { normalizeInboxWebhook } from '../src/inbox.js';
import {
  automationMeshHealth,
  deliverRelaycastFindingToN8n,
  routeRelaycastFinding,
  type AutomationMeshLogLevel,
} from '../src/automation-mesh.js';
import { InMemoryKarenStateClient } from '../src/state.js';

const nango = normalizeNangoWebhook({
  type: 'auth',
  connection: {
    integration_id: 'slack',
    connection_id: 'conn-1',
    provider_config_key: 'slack',
    scopes: ['chat:write'],
    metadata: { team: 'T1' },
  },
});
assertEqual(nango?.connection.integrationId, 'slack', 'nango integration id');
assertEqual(nango?.connection.scopes?.[0], 'chat:write', 'nango scopes');

const refreshedNango = normalizeNangoWebhook({
  operation: 'connection.refresh',
  data: {
    integration: 'github',
    connectionId: 'conn-github',
    providerConfigKey: 'github',
    expiresAt: '1760000000',
  },
  end_user: { id: 'user-1' },
});
assertEqual(refreshedNango?.connection.connectionId, 'conn-github', 'Nango refresh connection id');
assertEqual(refreshedNango?.connection.expiresAt, 1760000000, 'Nango refresh expiresAt');

const state = new InMemoryKarenStateClient({ monthlyBudgetUsd: 75 });
if (!refreshedNango) {
  throw new Error('Expected Nango refresh event');
}
await state.upsertNangoConnection(refreshedNango.connection);
const storedConnection = await state.getNangoConnection('github');
assertEqual(storedConnection?.connectionId, 'conn-github', 'Nango DO state update through state client');

const n8nInbox = normalizeInboxWebhook({
  source: 'n8n',
  workflow_id: 'wf-1',
  body: {
    title: 'Calendar prep brief',
  },
});
assertEqual(n8nInbox?.provider, 'n8n', 'n8n provider');
assertEqual(n8nInbox?.text, 'Calendar prep brief', 'n8n text');

const pipedreamInbox = normalizeInboxWebhook({
  source: 'pipedream',
  steps: {
    trigger: {
      event: {
        id: 'pd_evt_1',
        body: {
          summary: 'Pipedream ticket changed',
        },
      },
    },
  },
});
assertEqual(pipedreamInbox?.provider, 'pipedream', 'Pipedream provider');
assertEqual(pipedreamInbox?.externalId, 'pd_evt_1', 'Pipedream external id');

const composioInbox = normalizeInboxWebhook({
  provider: 'composio',
  payload: {
    event: 'gmail.message.created',
    data: {
      text: 'Composio Gmail message',
    },
  },
});
assertEqual(composioInbox?.provider, 'composio', 'Composio provider');
assertEqual(composioInbox?.text, 'Composio Gmail message', 'Composio text');

const routed = routeRelaycastFinding({
  channel: 'karen-findings/ricky-debug',
  messageId: 'msg-1',
  sender: 'ricky',
  timestamp: '2026-05-18T00:00:00.000Z',
  content: 'Workflow failed validation',
  metadata: {
    severity: 'high',
    prNumber: 42,
    filePaths: ['src/policy.ts'],
    agentRole: 'workflow-debugger',
    agentId: 'ricky-v1',
  },
});

assertEqual(routed?.route.pattern, 'karen-findings/*', 'n8n route');
assertEqual(routed?.payload.bridge.bridgeId, 'openkaren-bridge', 'bridge metadata');
assertEqual(routed?.payload.metadata.severity, 'high', 'severity preserved');

const finding = {
  channel: 'karen-findings/ricky-debug',
  messageId: 'msg-2',
  sender: 'ricky',
  timestamp: '2026-05-18T00:00:00.000Z',
  content: 'Workflow failed validation',
  metadata: {},
};
const logs: Array<{ level: AutomationMeshLogLevel; message: string }> = [];
const logger = (level: AutomationMeshLogLevel, message: string) => {
  logs.push({ level, message });
};

const routeMiss = await deliverRelaycastFindingToN8n(
  { ...finding, channel: 'unmatched/channel' },
  [{ pattern: 'karen-findings/*', webhook: 'http://n8n.local/hook' }],
  { logger },
);
assertEqual(routeMiss.status, 'route_miss', 'automation mesh route miss');

const routeHit = await deliverRelaycastFindingToN8n(
  finding,
  [{ pattern: 'karen-findings/*', webhook: 'http://n8n.local/hook' }],
  {
    logger,
    fetchImpl: async () => new Response('{}', { status: 202 }),
  },
);
assertEqual(routeHit.status, 'route_hit', 'automation mesh route hit');
assertEqual(routeHit.status === 'route_hit' ? routeHit.responseStatus : null, 202, 'automation mesh status');

const failedPost = await deliverRelaycastFindingToN8n(
  finding,
  [{ pattern: 'karen-findings/*', webhook: 'http://n8n.local/hook' }],
  {
    logger,
    fetchImpl: async () => new Response('boom', { status: 500 }),
  },
);
assertEqual(failedPost.status, 'failed_post', 'automation mesh failed POST');
assertEqual(
  automationMeshHealth([{ pattern: 'karen-findings/*', webhook: 'http://n8n.local/hook' }], failedPost).state,
  'degraded',
  'automation mesh health degraded',
);
assertEqual(automationMeshHealth([]).state, 'missing', 'automation mesh health missing');
if (
  !logs.some((item) => item.message === 'automation_mesh.route_miss') ||
  !logs.some((item) => item.message === 'automation_mesh.route_hit') ||
  !logs.some((item) => item.message === 'automation_mesh.failed_post')
) {
  throw new Error(`Expected route miss, route hit, and failed POST logs, got ${JSON.stringify(logs)}`);
}

console.log('automation mesh ok');

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
