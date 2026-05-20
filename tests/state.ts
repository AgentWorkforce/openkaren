import { createBridgeSessionId } from '../src/identity-bridge.js';
import { InMemoryKarenStateClient } from '../src/state.js';

const identityBridgeMappings = new Map([
  ['telegram:user-1', 'person-1'],
  ['slack:user-2', 'person-1'],
]);
const state = new InMemoryKarenStateClient({ monthlyBudgetUsd: 75, identityBridgeMappings });

const telegram = await state.getOrCreateBridgeSession({
  surface: 'telegram',
  channelId: 'telegram-chat',
  userId: 'user-1',
});
const slack = await state.getOrCreateBridgeSession({
  surface: 'slack',
  channelId: 'slack-dm',
  userId: 'user-2',
});

assertEqual(telegram.bridgeSessionId, 'bridge:user:person-1', 'Telegram explicit bridge:user:<id>');
assertEqual(slack.bridgeSessionId, telegram.bridgeSessionId, 'cross-surface bridge id');
assertEqual(
  createBridgeSessionId({ surface: 'slack', userId: 'U2' }),
  'bridge:user:U2',
  'automatic Slack bridge:user:<id>',
);

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

const lifecycleStates = [
  'accepted',
  'dispatched',
  'working',
  'completed',
  'timed_out',
  'failed_to_start',
  'failed_during_execution',
] as const;

for (const lifecycleState of lifecycleStates) {
  await state.putActiveRelayTurn({
    messageId: 'relay-message-1',
    sessionKey: 'relay-session-1',
    surfaceId: 'telegram',
    targetId: 'telegram-chat',
    workflowMode: 'orchestrated',
    lifecycleState,
    startedAt: '2026-05-20T10:00:00.000Z',
    updatedAt: `2026-05-20T10:00:0${Math.min(lifecycleStates.indexOf(lifecycleState), 9)}.000Z`,
    completedAt: lifecycleState === 'completed' ||
      lifecycleState === 'timed_out' ||
      lifecycleState === 'failed_to_start' ||
      lifecycleState === 'failed_during_execution'
      ? '2026-05-20T10:01:00.000Z'
      : null,
    rolesSpawned: ['planner', 'implementer', 'reviewer', 'verifier'],
    brokerReused: lifecycleState !== 'accepted',
    finalSummary: lifecycleState === 'completed' ? 'verifier summary' : undefined,
  });

  const persisted = await state.getActiveRelayTurn('relay-message-1');
  assertEqual(persisted?.lifecycleState, lifecycleState, `relay lifecycle ${lifecycleState}`);
  assertEqual(persisted?.sessionKey, 'relay-session-1', `relay session key ${lifecycleState}`);
  assertEqual(persisted?.workflowMode, 'orchestrated', `relay workflow ${lifecycleState}`);
  assertEqual(persisted?.rolesSpawned?.join(','), 'planner,implementer,reviewer,verifier', `relay roles ${lifecycleState}`);
}

const completedRelayTurn = await state.getActiveRelayTurn('relay-message-1');
assertEqual(completedRelayTurn?.lifecycleState, 'failed_during_execution', 'terminal relay lifecycle persistence');
assertEqual(completedRelayTurn?.completedAt, '2026-05-20T10:01:00.000Z', 'terminal relay completedAt');
assertEqual(await state.getActiveRelayTurn('missing-message'), null, 'missing relay lifecycle read');

console.log('state ok');

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
