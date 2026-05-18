import { InMemoryKarenStateClient } from '../src/state.js';

const state = new InMemoryKarenStateClient({ monthlyBudgetUsd: 75 });

const telegram = await state.getOrCreateBridgeSession({
  surface: 'telegram',
  channelId: 'telegram-chat',
  userId: 'user-1',
});
const slack = await state.getOrCreateBridgeSession({
  surface: 'slack',
  channelId: 'slack-dm',
  userId: 'user-1',
  existingBridgeId: telegram.bridgeSessionId,
});

assertEqual(slack.bridgeSessionId, telegram.bridgeSessionId, 'cross-surface bridge id');

await state.appendMessage({
  sessionId: telegram.id,
  role: 'user',
  content: 'remember budget-aware routing',
  messageId: 'm1',
});
const messages = await state.searchMessages('budget-aware');
assertEqual(messages.length, 1, 'message search');

const deny = await state.checkAndRecordSpend({
  input: 0,
  output: 0,
  estimatedCostUsd: 76,
});
assertEqual(deny.outcome, 'deny', 'budget overrun denied atomically');

await state.upsertNangoConnection({
  integrationId: 'slack',
  connectionId: 'conn-slack',
  providerConfigKey: 'slack',
  scopes: ['chat:write'],
});
assertEqual((await state.getNangoConnection('slack'))?.connectionId, 'conn-slack', 'nango connection');

await state.putMemory({
  id: 'mem-1',
  type: 'preference',
  content: 'Prefer Telegram for daily standups',
});
assertEqual((await state.searchMemory('Telegram')).length, 1, 'memory search');

await state.putWorkflow({
  id: 'wf-1',
  type: 'scheduled',
  status: 'pending',
  scheduledAt: Date.now() - 1,
});
assertEqual((await state.dueWorkflows()).length, 1, 'due workflow query');

console.log('state ok');

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
