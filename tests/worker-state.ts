import worker, { KarenUserDO } from '../workers/karen/src/index.js';

class FakeSqlStorage {
  private readonly activeRelayTurns = new Map<string, Record<string, unknown>>();

  exec(query: string, ...bindings: unknown[]): QueryResult {
    if (query.includes('INSERT INTO active_relay_turns')) {
      const [
        messageId,
        sessionKey,
        surfaceId,
        targetId,
        workflowMode,
        lifecycleState,
        startedAt,
        updatedAt,
        completedAt,
        rolesSpawned,
        brokerReused,
        finalSummary,
      ] = bindings;

      this.activeRelayTurns.set(String(messageId), {
        message_id: messageId,
        session_key: sessionKey,
        surface_id: surfaceId,
        target_id: targetId,
        workflow_mode: workflowMode,
        lifecycle_state: lifecycleState,
        started_at: startedAt,
        updated_at: updatedAt,
        completed_at: completedAt,
        roles_spawned: rolesSpawned,
        broker_reused: brokerReused,
        final_summary: finalSummary,
      });
    }

    if (query.includes('FROM active_relay_turns WHERE message_id = ?')) {
      const row = this.activeRelayTurns.get(String(bindings[0]));
      return queryResult(row ? [row] : []);
    }

    return queryResult([]);
  }
}

const sql = new FakeSqlStorage();
const durableObject = new KarenUserDO({
  storage: {
    sql,
    setAlarm: async () => {},
  },
  blockConcurrencyWhile(callback: () => Promise<void> | void): void {
    void callback();
  },
}, {} as never);

const activeTurn = {
  messageId: 'relay-message-1',
  sessionKey: 'relay-session-1',
  surfaceId: 'telegram',
  targetId: 'telegram-chat',
  workflowMode: 'orchestrated',
  lifecycleState: 'completed',
  startedAt: '2026-05-20T10:00:00.000Z',
  updatedAt: '2026-05-20T10:01:00.000Z',
  completedAt: '2026-05-20T10:01:00.000Z',
  rolesSpawned: ['planner', 'implementer', 'reviewer', 'verifier'],
  brokerReused: true,
  finalSummary: 'verified relay summary',
};

const writeResponse = await durableObject.fetch(new Request('http://state.local/relay/active-turn', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(activeTurn),
}));

assertEqual(writeResponse.status, 200, 'active turn write status');

const readResponse = await durableObject.fetch(
  new Request('http://state.local/relay/active-turn/relay-message-1'),
);
const persisted = await readResponse.json() as typeof activeTurn;

assertEqual(readResponse.status, 200, 'active turn read status');
assertEqual(persisted.messageId, activeTurn.messageId, 'messageId round trip');
assertEqual(persisted.sessionKey, activeTurn.sessionKey, 'sessionKey round trip');
assertEqual(persisted.surfaceId, activeTurn.surfaceId, 'surfaceId round trip');
assertEqual(persisted.targetId, activeTurn.targetId, 'targetId round trip');
assertEqual(persisted.lifecycleState, activeTurn.lifecycleState, 'lifecycleState round trip');
assertEqual(persisted.workflowMode, activeTurn.workflowMode, 'workflowMode round trip');
assertEqual(persisted.rolesSpawned.join(','), activeTurn.rolesSpawned.join(','), 'rolesSpawned round trip');
assertEqual(persisted.brokerReused, activeTurn.brokerReused, 'brokerReused round trip');
assertEqual(persisted.completedAt, activeTurn.completedAt, 'completedAt round trip');
assertEqual(persisted.finalSummary, activeTurn.finalSummary, 'finalSummary round trip');

const missingResponse = await durableObject.fetch(
  new Request('http://state.local/relay/active-turn/missing-message'),
);
assertEqual(await missingResponse.json(), null, 'missing active turn');

const unauthenticatedProduction = await worker.fetch(new Request('https://state.example/sessions', {
  method: 'POST',
}), {
  KAREN_DO: {
    idFromName: (name: string) => name,
    get: () => durableObject,
  },
} as never);
assertEqual(unauthenticatedProduction.status, 401, 'production state worker requires auth token');

const localWithoutToken = await worker.fetch(new Request('http://127.0.0.1/sessions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    surface: 'telegram',
    channelId: '123',
    userId: 'u1',
  }),
}), {
  KAREN_DO: {
    idFromName: (name: string) => name,
    get: () => durableObject,
  },
} as never);
assertEqual(localWithoutToken.status, 200, 'local state worker can run without auth token');

console.log('worker state ok');

type QueryResult = {
  toArray(): Array<Record<string, unknown>>;
  one<T = Record<string, unknown>>(): T | null;
};

function queryResult(rows: Array<Record<string, unknown>>): QueryResult {
  return {
    toArray: () => rows,
    one: <T = Record<string, unknown>>() => rows[0] as T | undefined ?? null,
  };
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
