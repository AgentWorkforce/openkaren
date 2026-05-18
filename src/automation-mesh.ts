export type RelaycastFinding = {
  channel: string;
  messageId: string;
  sender: string;
  timestamp: string;
  content: string;
  metadata: {
    severity?: 'critical' | 'high' | 'medium' | 'low';
    prNumber?: number;
    filePaths?: string[];
    agentRole?: string;
    agentId?: string;
    [key: string]: unknown;
  };
};

export type N8nRoute = {
  pattern: string;
  webhook: string;
};

export type N8nForwardPayload = RelaycastFinding & {
  bridge: {
    bridgeId: string;
    routeRef: string;
    processedAt: string;
  };
};

export const DEFAULT_N8N_ROUTES: readonly N8nRoute[] = [
  { pattern: 'karen-findings/*', webhook: 'http://n8n:5678/webhook/karen-findings' },
  { pattern: 'ricky-debug/*', webhook: 'http://n8n:5678/webhook/ricky-findings' },
  { pattern: 'sage-plans/*', webhook: 'http://n8n:5678/webhook/sage-output' },
  { pattern: 'karen-proactive/*', webhook: 'http://n8n:5678/webhook/proactive-surface' },
];

export function routeRelaycastFinding(
  finding: RelaycastFinding,
  routes: readonly N8nRoute[] = DEFAULT_N8N_ROUTES,
): { route: N8nRoute; payload: N8nForwardPayload } | null {
  const route = routes.find((candidate) => globMatches(candidate.pattern, finding.channel));
  if (!route) return null;
  return {
    route,
    payload: {
      ...finding,
      bridge: {
        bridgeId: 'openkaren-bridge',
        routeRef: route.pattern,
        processedAt: new Date().toISOString(),
      },
    },
  };
}

export async function forwardRelaycastFindingToN8n(
  finding: RelaycastFinding,
  routes: readonly N8nRoute[] = DEFAULT_N8N_ROUTES,
): Promise<boolean> {
  const routed = routeRelaycastFinding(finding, routes);
  if (!routed) return false;
  const response = await fetch(routed.route.webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(routed.payload),
  });
  if (!response.ok) {
    throw new Error(`n8n route ${routed.route.pattern} failed with ${response.status}`);
  }
  return true;
}

function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(value);
}
