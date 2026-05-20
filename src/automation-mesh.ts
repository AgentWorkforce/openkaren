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

export type AutomationMeshLogLevel = 'info' | 'warn' | 'error';

export type AutomationMeshLogger = (
  level: AutomationMeshLogLevel,
  message: string,
  fields: Record<string, unknown>,
) => void;

export type AutomationMeshDeliveryResult =
  | {
    status: 'route_miss';
    finding: RelaycastFinding;
    checkedRoutes: string[];
  }
  | {
    status: 'route_hit';
    route: N8nRoute;
    payload: N8nForwardPayload;
    responseStatus: number;
  }
  | {
    status: 'failed_post';
    route: N8nRoute;
    payload: N8nForwardPayload;
    responseStatus: number | null;
    error: string;
  };

export type ForwardRelaycastFindingOptions = {
  fetchImpl?: typeof fetch;
  logger?: AutomationMeshLogger;
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
  options: ForwardRelaycastFindingOptions = {},
): Promise<boolean> {
  const result = await deliverRelaycastFindingToN8n(finding, routes, options);
  if (result.status === 'failed_post') {
    throw new Error(`n8n route ${result.route.pattern} failed: ${result.error}`);
  }
  return result.status === 'route_hit';
}

export async function deliverRelaycastFindingToN8n(
  finding: RelaycastFinding,
  routes: readonly N8nRoute[] = DEFAULT_N8N_ROUTES,
  options: ForwardRelaycastFindingOptions = {},
): Promise<AutomationMeshDeliveryResult> {
  const logger = options.logger ?? defaultLogger;
  const routed = routeRelaycastFinding(finding, routes);
  if (!routed) {
    const result: AutomationMeshDeliveryResult = {
      status: 'route_miss',
      finding,
      checkedRoutes: routes.map((route) => route.pattern),
    };
    logger('warn', 'automation_mesh.route_miss', {
      channel: finding.channel,
      checkedRoutes: result.checkedRoutes,
    });
    return result;
  }

  logger('info', 'automation_mesh.route_hit', {
    channel: finding.channel,
    route: routed.route.pattern,
    webhook: routed.route.webhook,
  });

  try {
    const response = await (options.fetchImpl ?? fetch)(routed.route.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(routed.payload),
    });
    if (!response.ok) {
      const result: AutomationMeshDeliveryResult = {
        status: 'failed_post',
        route: routed.route,
        payload: routed.payload,
        responseStatus: response.status,
        error: `HTTP ${response.status}`,
      };
      logger('error', 'automation_mesh.failed_post', {
        channel: finding.channel,
        route: routed.route.pattern,
        status: response.status,
      });
      return result;
    }

    return {
      status: 'route_hit',
      route: routed.route,
      payload: routed.payload,
      responseStatus: response.status,
    };
  } catch (error) {
    const result: AutomationMeshDeliveryResult = {
      status: 'failed_post',
      route: routed.route,
      payload: routed.payload,
      responseStatus: null,
      error: error instanceof Error ? error.message : String(error),
    };
    logger('error', 'automation_mesh.failed_post', {
      channel: finding.channel,
      route: routed.route.pattern,
      error: result.error,
    });
    return result;
  }
}

export function automationMeshHealth(
  routes: readonly N8nRoute[] = DEFAULT_N8N_ROUTES,
  lastResult?: AutomationMeshDeliveryResult,
): { state: 'configured' | 'missing' | 'degraded'; routeCount: number; routes: string[]; lastStatus?: string } {
  const routeCount = routes.length;
  const lastStatus = lastResult?.status;
  return {
    state: routeCount === 0 ? 'missing' : lastStatus === 'failed_post' ? 'degraded' : 'configured',
    routeCount,
    routes: routes.map((route) => `${route.pattern} -> ${route.webhook}`),
    lastStatus,
  };
}

function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function defaultLogger(
  level: AutomationMeshLogLevel,
  message: string,
  fields: Record<string, unknown>,
): void {
  console[level]('OpenKaren automation mesh', { message, ...fields });
}
