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

console.log('slack ok');

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
