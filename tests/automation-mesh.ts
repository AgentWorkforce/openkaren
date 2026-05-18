import { normalizeNangoWebhook } from '../src/nango.js';
import { routeRelaycastFinding } from '../src/automation-mesh.js';

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

console.log('automation mesh ok');

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
