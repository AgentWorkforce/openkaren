import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  OpenKarenConfig,
  SlackEventPayload,
  SlackOutboundFormat,
} from './types.js';

export const SLACK_SURFACE_ID = 'slack';

export type SlackDispatchResult =
  | { type: 'challenge'; challenge: string }
  | { type: 'accepted'; payload: SlackEventPayload }
  | { type: 'ignored'; reason: string };

export function normalizeSlackEvent(
  surfaceId: string,
  payload: SlackEventPayload,
): {
  id: string;
  surfaceId: string;
  sessionId: string;
  userId: string;
  workspaceId: string;
  text: string;
  raw: { slack: SlackEventPayload };
  receivedAt: string;
  capability: string;
  format: SlackOutboundFormat;
} | null {
  const event = payload.event;
  if (!event?.text || !event.channel || !event.user || event.bot_id) {
    return null;
  }

  const userId = event.user;
  const teamId = payload.team_id ?? event.team ?? 'slack';
  const ts = event.ts ?? String(Date.now());
  const threadTs = event.thread_ts ?? ts;

  return {
    id: `slack:${payload.event_id ?? ts}`,
    surfaceId,
    sessionId: `bridge:user:${userId}`,
    userId,
    workspaceId: `slack:${teamId}`,
    text: event.text,
    raw: { slack: payload },
    receivedAt: timestampToIso(ts),
    capability: 'chat',
    format: slackFormat(payload),
  };
}

export function slackFormat(payload: SlackEventPayload): SlackOutboundFormat {
  return {
    channelId: payload.event?.channel,
    threadTs: payload.event?.thread_ts ?? payload.event?.ts,
    responseUrl: payload.response_url,
  };
}

export async function sendSlackFormatted(
  config: Pick<OpenKarenConfig, 'slackBotToken'>,
  format: unknown,
  text: string,
): Promise<void> {
  const outbound = isSlackOutboundFormat(format) ? format : {};
  if (outbound.responseUrl) {
    const response = await fetch(outbound.responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        response_type: 'ephemeral',
        thread_ts: outbound.threadTs,
      }),
    });
    if (!response.ok) {
      throw new Error(`Slack response_url failed with ${response.status}`);
    }
    return;
  }

  if (!config.slackBotToken || !outbound.channelId) {
    throw new Error('Slack outbound requires SLACK_BOT_TOKEN and channelId');
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.slackBotToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      channel: outbound.channelId,
      thread_ts: outbound.threadTs,
      text,
    }),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error ?? `Slack chat.postMessage failed with ${response.status}`);
  }
}

export function normalizeSlackWebhook(
  config: Pick<OpenKarenConfig, 'slackEnabled' | 'slackAllowedChannelIds' | 'slackSigningSecret'>,
  input: {
    headers?: Record<string, string | string[] | undefined>;
    rawBody: string;
    parsedBody: unknown;
  },
): SlackDispatchResult {
  if (!config.slackEnabled) {
    return { type: 'ignored', reason: 'slack-disabled' };
  }
  if (config.slackSigningSecret && !hasValidSlackSignature(config.slackSigningSecret, input.headers, input.rawBody)) {
    return { type: 'ignored', reason: 'invalid-signature' };
  }

  const payload = isSlackPayload(input.parsedBody) ? input.parsedBody : null;
  if (!payload) {
    return { type: 'ignored', reason: 'invalid-payload' };
  }
  if (payload.type === 'url_verification' && payload.challenge) {
    return { type: 'challenge', challenge: payload.challenge };
  }
  const channelId = payload.event?.channel;
  if (
    channelId &&
    config.slackAllowedChannelIds.size > 0 &&
    !config.slackAllowedChannelIds.has(channelId)
  ) {
    return { type: 'ignored', reason: 'channel-not-allowed' };
  }

  return { type: 'accepted', payload };
}

function hasValidSlackSignature(
  signingSecret: string,
  headers: Record<string, string | string[] | undefined> | undefined,
  rawBody: string,
): boolean {
  const timestamp = headerValue(headers, 'x-slack-request-timestamp');
  const signature = headerValue(headers, 'x-slack-signature');
  if (!timestamp || !signature) return false;
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) return false;

  const expected = `v0=${createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex')}`;
  return safeEqual(signature, expected);
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | null {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isSlackPayload(value: unknown): value is SlackEventPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSlackOutboundFormat(value: unknown): value is SlackOutboundFormat {
  return typeof value === 'object' && value !== null;
}

function timestampToIso(ts: string): string {
  const seconds = Number.parseFloat(ts);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}
