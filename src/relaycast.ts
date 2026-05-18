import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type {
  OpenKarenConfig,
  RelaycastOutboundFormat,
  RelaycastWebhookPayload,
} from './types.js';
import {
  INBOX_WEBHOOK_PATH,
  normalizeInboxWebhook,
  type OpenKarenInboxEvent,
} from './inbox.js';
import { normalizeNangoWebhook, type NangoWebhookEvent } from './nango.js';
import {
  normalizeRelayCronProactivePayload,
  normalizeRelayCronProgressPayload,
  relayCronWebhookConfigured,
  relayCronWebhookPath,
  type RelayCronProactiveTurn,
  type RelayCronProgressTurn,
} from './relaycron.js';
import {
  normalizeSlackWebhook,
  type SlackDispatchResult,
} from './slack.js';
import { buildDashboardData, renderDashboard } from './dashboard.js';

const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
const DEFAULT_DASHBOARD_PATH = '/dashboard';

export const RELAYCAST_SURFACE_ID = 'relaycast';

export type RelaycastWebhookDispatchInput = {
  method?: string;
  path: string;
  headers?: IncomingMessage['headers'];
  body?: unknown;
};

export type RelaycastWebhookDispatchResult = {
  statusCode: number;
  body: Record<string, unknown>;
};

export class RelaycastWebhookServer {
  private server: Server | null = null;

  constructor(
    private readonly config: OpenKarenConfig,
    private readonly onWebhook: (payload: RelaycastWebhookPayload) => void,
    private readonly onRelayCronProgress?: (turn: RelayCronProgressTurn) => void,
    private readonly onRelayCronProactive?: (turn: RelayCronProactiveTurn) => void,
    private readonly onInboxEvent?: (event: OpenKarenInboxEvent) => void,
    private readonly onSlackEvent?: (payload: RelaycastWebhookPayload) => void,
    private readonly onNangoEvent?: (event: NangoWebhookEvent) => void,
  ) {}

  async start(): Promise<void> {
    if (this.server || !this.shouldListen()) {
      return;
    }

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server as Server;
      const onError = (error: Error) => {
        server.off('listening', onListening);
        this.server = null;
        server.close(() => {});
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.config.relaycastPort, this.config.relaycastHost);
    });

    console.info('OpenKaren Relaycast webhook listener started', {
      host: this.config.relaycastHost,
      port: this.config.relaycastPort,
      relaycastPath: this.config.relaycastEnabled ? this.config.relaycastWebhookPath : null,
      relaycronPath: this.relayCronPath(),
      dashboardPath: this.dashboardEnabled() ? this.dashboardPath() : null,
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async dispatchForTesting(
    input: RelaycastWebhookDispatchInput,
  ): Promise<RelaycastWebhookDispatchResult> {
    const request = syntheticRequest(input);
    const response = syntheticResponse();
    await this.handle(request, response.response);
    return await response.result;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'http://openkaren.local');
    if (this.dashboardEnabled() && requestUrl.pathname === this.dashboardPath()) {
      await this.handleDashboard(requestUrl, response);
      return;
    }

    if (this.dashboardEnabled() && requestUrl.pathname === `${this.dashboardPath()}/data`) {
      await this.handleDashboardData(requestUrl, response);
      return;
    }

    if (requestUrl.pathname === this.relayCronPath()) {
      await this.handleRelayCron(request, response);
      return;
    }

    if (requestUrl.pathname === INBOX_WEBHOOK_PATH) {
      await this.handleInbox(request, response);
      return;
    }

    if (requestUrl.pathname === this.config.slackWebhookPath) {
      await this.handleSlack(request, response);
      return;
    }

    if (requestUrl.pathname === this.config.nangoWebhookPath) {
      await this.handleNango(request, response);
      return;
    }

    if (!this.config.relaycastEnabled || requestUrl.pathname !== this.config.relaycastWebhookPath) {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    if (!this.hasValidSecret(request)) {
      sendJson(response, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    const body = await readRequestBody(request).catch((error: unknown) => {
      sendJson(response, 413, {
        ok: false,
        error: error instanceof Error ? error.message : 'body_too_large',
      });
      return null;
    });
    if (body === null) {
      return;
    }

    const payload = parseRelaycastPayload(body);
    if (!payload) {
      sendJson(response, 400, { ok: false, error: 'invalid_json' });
      return;
    }

    this.onWebhook(payload);
    sendJson(response, 202, { ok: true });
  }

  private async handleRelayCron(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (
      !relayCronWebhookConfigured(this.config) ||
      (!this.onRelayCronProgress && !this.onRelayCronProactive)
    ) {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    const body = await readRequestBody(request).catch((error: unknown) => {
      sendJson(response, 413, {
        ok: false,
        error: error instanceof Error ? error.message : 'body_too_large',
      });
      return null;
    });
    if (body === null) {
      return;
    }

    const payload = parseJsonRecord(body);
    if (!payload) {
      sendJson(response, 400, { ok: false, error: 'invalid_json' });
      return;
    }

    const progressTurn = normalizeRelayCronProgressPayload(payload);
    if (progressTurn && this.onRelayCronProgress) {
      this.onRelayCronProgress(progressTurn);
      sendJson(response, 202, { ok: true });
      return;
    }

    const proactiveTurn = normalizeRelayCronProactivePayload(payload);
    if (proactiveTurn && this.onRelayCronProactive) {
      this.onRelayCronProactive(proactiveTurn);
      sendJson(response, 202, { ok: true });
      return;
    }

    if (!proactiveTurn) {
      sendJson(response, 400, { ok: false, error: 'invalid_relaycron_payload' });
      return;
    }

    sendJson(response, 404, { ok: false, error: 'proactive_handler_not_configured' });
  }

  private async handleInbox(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.onInboxEvent) {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    const body = await readRequestBody(request).catch((error: unknown) => {
      sendJson(response, 413, {
        ok: false,
        error: error instanceof Error ? error.message : 'body_too_large',
      });
      return null;
    });
    if (body === null) {
      return;
    }

    const payload = parseJsonRecord(body);
    if (!payload) {
      sendJson(response, 400, { ok: false, error: 'invalid_json' });
      return;
    }

    const event = normalizeInboxWebhook(payload);
    if (!event) {
      sendJson(response, 400, { ok: false, error: 'invalid_inbox_payload' });
      return;
    }

    this.onInboxEvent(event);
    sendJson(response, 202, { ok: true });
  }

  private async handleSlack(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.onSlackEvent) {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }

    const body = await readRequestBody(request).catch((error: unknown) => {
      sendJson(response, 413, {
        ok: false,
        error: error instanceof Error ? error.message : 'body_too_large',
      });
      return null;
    });
    if (body === null) {
      return;
    }

    const payload = parseJsonRecord(body);
    const result: SlackDispatchResult = normalizeSlackWebhook(this.config, {
      headers: request.headers,
      rawBody: body,
      parsedBody: payload,
    });
    if (result.type === 'challenge') {
      sendJson(response, 200, { challenge: result.challenge });
      return;
    }
    if (result.type === 'ignored') {
      sendJson(response, result.reason === 'invalid-signature' ? 401 : 202, {
        ok: result.reason !== 'invalid-signature',
        ignored: result.reason,
      });
      return;
    }

    this.onSlackEvent(result.payload as RelaycastWebhookPayload);
    sendJson(response, 202, { ok: true });
  }

  private async handleNango(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!this.onNangoEvent) {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }
    const body = await readRequestBody(request).catch((error: unknown) => {
      sendJson(response, 413, {
        ok: false,
        error: error instanceof Error ? error.message : 'body_too_large',
      });
      return null;
    });
    if (body === null) return;

    const payload = parseJsonRecord(body);
    const event = normalizeNangoWebhook(payload);
    if (!event) {
      sendJson(response, 400, { ok: false, error: 'invalid_nango_payload' });
      return;
    }

    this.onNangoEvent(event);
    sendJson(response, 202, { ok: true });
  }

  private hasValidSecret(request: IncomingMessage): boolean {
    const expected = this.config.relaycastWebhookSecret;
    if (!expected) {
      return true;
    }

    const authorization = request.headers.authorization;
    const webhookSecret = request.headers['x-relaycast-secret'];
    return authorization === `Bearer ${expected}` || webhookSecret === expected;
  }

  private shouldListen(): boolean {
    return this.dashboardEnabled() || this.config.relaycastEnabled || relayCronWebhookConfigured(this.config);
  }

  private dashboardEnabled(): boolean {
    return this.config.dashboardEnabled !== false;
  }

  private dashboardPath(): string {
    return this.config.dashboardPath || DEFAULT_DASHBOARD_PATH;
  }

  private async handleDashboard(requestUrl: URL, response: ServerResponse): Promise<void> {
    const data = await buildDashboardData(
      this.config,
      requestUrl.searchParams.get('user') ?? this.config.stateUserId,
    );
    sendHtml(response, 200, renderDashboard(data));
  }

  private async handleDashboardData(requestUrl: URL, response: ServerResponse): Promise<void> {
    const data = await buildDashboardData(
      this.config,
      requestUrl.searchParams.get('user') ?? this.config.stateUserId,
    );
    sendJson(response, 200, data as unknown as Record<string, unknown>);
  }

  private relayCronPath(): string | null {
    return relayCronWebhookConfigured(this.config)
      ? relayCronWebhookPath(this.config)
      : null;
  }
}

function syntheticRequest(input: RelaycastWebhookDispatchInput): IncomingMessage {
  const body = typeof input.body === 'string'
    ? input.body
    : input.body === undefined
      ? ''
      : JSON.stringify(input.body);
  const request = Readable.from(body ? [body] : []) as unknown as IncomingMessage;
  Object.assign(request, {
    method: input.method ?? 'POST',
    url: input.path,
    headers: input.headers ?? {},
  });
  return request;
}

function syntheticResponse(): {
  response: ServerResponse;
  result: Promise<RelaycastWebhookDispatchResult>;
} {
  let statusCode = 200;
  let body = '';
  let resolveResult: (result: RelaycastWebhookDispatchResult) => void;
  const result = new Promise<RelaycastWebhookDispatchResult>((resolve) => {
    resolveResult = resolve;
  });

  const response = {
    writeHead(code: number) {
      statusCode = code;
      return response;
    },
    end(chunk?: unknown) {
      body += chunk === undefined ? '' : String(chunk);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = body ? JSON.parse(body) as Record<string, unknown> : {};
      } catch {
        parsed = { raw: body };
      }
      resolveResult({ statusCode, body: parsed });
      return response;
    },
  } as unknown as ServerResponse;

  return { response, result };
}

export function normalizeRelaycastWebhook(
  surfaceId: string,
  payload: RelaycastWebhookPayload,
): {
  id: string;
  surfaceId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  text: string;
  raw: { relaycast: RelaycastWebhookPayload };
  receivedAt: string;
  capability: string;
} | null {
  const message = payload.message ?? payload.event;
  const text = normalizeString(message?.text) ?? normalizeString(payload.text);
  if (!text) {
    return null;
  }

  const workspaceId =
    normalizeString(payload.workspace_id) ?? normalizeString(payload.workspaceId) ?? 'default';
  const channelId =
    normalizeString(message?.channel_id) ??
    normalizeString(message?.channelId) ??
    normalizeString(payload.channel_id) ??
    normalizeString(payload.channelId) ??
    'inbox';
  const threadId =
    normalizeString(message?.thread_id) ??
    normalizeString(message?.threadId) ??
    normalizeString(payload.thread_id) ??
    normalizeString(payload.threadId) ??
    channelId;
  const userId =
    normalizeString(message?.user_id) ??
    normalizeString(message?.userId) ??
    normalizeString(payload.user_id) ??
    normalizeString(payload.userId) ??
    'relaycast';
  const eventId =
    normalizeString(payload.id) ??
    normalizeString(payload.event_id) ??
    normalizeString(message?.id) ??
    `${workspaceId}:${channelId}:${Date.now()}`;
  const receivedAt =
    normalizeString(message?.created_at) ??
    normalizeString(message?.createdAt) ??
    normalizeString(payload.created_at) ??
    normalizeString(payload.createdAt) ??
    new Date().toISOString();

  return {
    id: `relaycast:${eventId}`,
    surfaceId,
    sessionId: `relaycast:${workspaceId}:${channelId}:${threadId}`,
    userId,
    workspaceId,
    text,
    raw: { relaycast: payload },
    receivedAt,
    capability: 'chat',
  };
}

export async function sendRelaycastFormatted(format: unknown, text: string): Promise<void> {
  const outbound = isRelaycastOutboundFormat(format) ? format : {};
  const targetUrl = outbound.responseUrl ?? outbound.replyUrl;
  if (!targetUrl) {
    console.info('Relaycast response has no responseUrl; skipping outbound webhook reply');
    return;
  }

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      workspace_id: outbound.workspaceId,
      channel_id: outbound.channelId,
      thread_id: outbound.threadId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Relaycast response webhook failed with ${response.status}`);
  }
}

export function relaycastFormat(payload: RelaycastWebhookPayload): RelaycastOutboundFormat {
  const message = payload.message ?? payload.event;
  return {
    responseUrl: normalizeString(payload.response_url),
    replyUrl: normalizeString(payload.reply_url),
    workspaceId: normalizeString(payload.workspace_id) ?? normalizeString(payload.workspaceId),
    channelId:
      normalizeString(message?.channel_id) ??
      normalizeString(message?.channelId) ??
      normalizeString(payload.channel_id) ??
      normalizeString(payload.channelId),
    threadId:
      normalizeString(message?.thread_id) ??
      normalizeString(message?.threadId) ??
      normalizeString(payload.thread_id) ??
      normalizeString(payload.threadId),
  };
}

function parseRelaycastPayload(body: string): RelaycastWebhookPayload | null {
  return parseJsonRecord(body) as RelaycastWebhookPayload | null;
}

function parseJsonRecord(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';

    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_WEBHOOK_BODY_BYTES) {
        reject(new Error('body_too_large'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRelaycastOutboundFormat(value: unknown): value is RelaycastOutboundFormat {
  return typeof value === 'object' && value !== null;
}
