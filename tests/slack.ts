import { createHmac } from 'node:crypto';
import { normalizeSlackEvent, normalizeSlackWebhook, slackFormat } from '../src/slack.js';

const now = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify({
  type: 'event_callback',
  event_id: 'Ev1',
  team_id: 'T1',
  event: {
    type: 'message',
    user: 'U1',
    text: 'Karen summarize this thread',
    channel: 'C1',
    ts: '1710000000.000100',
    thread_ts: '1710000000.000000',
  },
});
const signature = `v0=${createHmac('sha256', 'secret').update(`v0:${now}:${body}`).digest('hex')}`;

const dispatch = normalizeSlackWebhook(
  {
    slackEnabled: true,
    slackAllowedChannelIds: new Set(['C1']),
    slackSigningSecret: 'secret',
  },
  {
    headers: {
      'x-slack-request-timestamp': now,
      'x-slack-signature': signature,
    },
    rawBody: body,
    parsedBody: JSON.parse(body) as unknown,
  },
);

if (dispatch.type !== 'accepted') {
  throw new Error(`Expected accepted Slack dispatch, got ${dispatch.type}`);
}

const message = normalizeSlackEvent('slack', dispatch.payload);
assertEqual(message?.sessionId, 'bridge:user:U1', 'slack bridge session');
assertEqual(message?.workspaceId, 'slack:T1', 'slack workspace');
assertEqual(slackFormat(dispatch.payload).threadTs, '1710000000.000000', 'slack thread format');

const mappedMessage = normalizeSlackEvent('slack', dispatch.payload, new Map([['slack:U1', 'person-1']]));
assertEqual(mappedMessage?.sessionId, 'bridge:user:person-1', 'slack explicit bridge mapping');

const urlVerification = normalizeSlackWebhook(
  {
    slackEnabled: true,
    slackAllowedChannelIds: new Set(),
    slackSigningSecret: null,
  },
  {
    rawBody: JSON.stringify({ type: 'url_verification', challenge: 'challenge-token' }),
    parsedBody: { type: 'url_verification', challenge: 'challenge-token' },
  },
);
assertEqual(urlVerification.type, 'challenge', 'Slack URL verification');
if (urlVerification.type === 'challenge') {
  assertEqual(urlVerification.challenge, 'challenge-token', 'Slack URL verification challenge');
}

const invalidSignature = normalizeSlackWebhook(
  {
    slackEnabled: true,
    slackAllowedChannelIds: new Set(['C1']),
    slackSigningSecret: 'secret',
  },
  {
    headers: {
      'x-slack-request-timestamp': now,
      'x-slack-signature': 'v0=invalid',
    },
    rawBody: body,
    parsedBody: JSON.parse(body) as unknown,
  },
);
assertEqual(invalidSignature.type, 'ignored', 'Slack signature failure');
if (invalidSignature.type === 'ignored') {
  assertEqual(invalidSignature.reason, 'invalid-signature', 'Slack signature failure reason');
}

const blocked = normalizeSlackWebhook(
  {
    slackEnabled: true,
    slackAllowedChannelIds: new Set(['C2']),
    slackSigningSecret: null,
  },
  {
    rawBody: body,
    parsedBody: JSON.parse(body) as unknown,
  },
);
assertEqual(blocked.type, 'ignored', 'channel allowlist');

const disabled = normalizeSlackWebhook(
  {
    slackEnabled: false,
    slackAllowedChannelIds: new Set(['C1']),
    slackSigningSecret: null,
  },
  {
    rawBody: body,
    parsedBody: JSON.parse(body) as unknown,
  },
);
assertEqual(disabled.type, 'ignored', 'Slack disabled state');
if (disabled.type === 'ignored') {
  assertEqual(disabled.reason, 'slack-disabled', 'Slack disabled reason');
}

console.log('slack ok');

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
