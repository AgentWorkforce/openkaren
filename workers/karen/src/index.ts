export type Env = {
  KAREN_DO: DurableObjectNamespace<KarenUserDO>;
  KAREN_STATE_TOKEN?: string;
};

type SqlStorage = {
  exec(query: string, ...bindings: unknown[]): {
    toArray(): Array<Record<string, unknown>>;
    one<T = Record<string, unknown>>(): T | null;
  };
};

type DurableObjectState = {
  storage: {
    sql: SqlStorage;
    setAlarm(timestamp: number): Promise<void>;
  };
  blockConcurrencyWhile(callback: () => Promise<void> | void): void;
};

type DurableObjectNamespace<T> = {
  idFromName(name: string): unknown;
  get(id: unknown): T;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, auth: authMode(request, env), durableObject: 'KarenUserDO' });
    }

    if (!authorized(request, env)) {
      return json({ error: 'unauthorized', auth: authMode(request, env) }, 401);
    }

    const userId = request.headers.get('x-openkaren-user-id') || 'local';
    const id = env.KAREN_DO.idFromName(userId);
    return env.KAREN_DO.get(id).fetch(request);
  },
};

export class KarenUserDO {
  private readonly sql: SqlStorage;

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {
    void this.env;
    this.sql = ctx.storage.sql;
    this.ctx.blockConcurrencyWhile(() => this.migrate());
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/sessions') {
      return json(this.getOrCreateBridgeSession(await request.json() as Record<string, unknown>));
    }
    if (request.method === 'POST' && url.pathname === '/messages') {
      this.appendMessage(await request.json() as Record<string, unknown>);
      return json({ ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/search/messages') {
      return json(this.searchMessages(url.searchParams.get('q') ?? ''));
    }
    if (request.method === 'POST' && url.pathname === '/budget/check-and-record') {
      return json(this.checkAndRecordSpend(await request.json() as Record<string, unknown>));
    }
    if (request.method === 'POST' && url.pathname === '/nango-connection') {
      this.upsertNangoConnection(await request.json() as Record<string, unknown>);
      return json({ ok: true });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/nango-connection/')) {
      return json(this.getNangoConnection(decodeURIComponent(url.pathname.split('/').pop() ?? '')));
    }
    if (request.method === 'POST' && url.pathname === '/memory') {
      this.putMemory(await request.json() as Record<string, unknown>);
      return json({ ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/search/memory') {
      return json(this.searchMemory(url.searchParams.get('q') ?? ''));
    }
    if (request.method === 'POST' && url.pathname === '/workflow') {
      await this.putWorkflow(await request.json() as Record<string, unknown>);
      return json({ ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/workflow/due') {
      return json(this.dueWorkflows(Number(url.searchParams.get('now') ?? Date.now())));
    }
    if (request.method === 'POST' && url.pathname === '/relay/active-turn') {
      return json(this.putActiveRelayTurn(await request.json() as Record<string, unknown>));
    }
    if (request.method === 'GET' && url.pathname.startsWith('/relay/active-turn/')) {
      return json(this.getActiveRelayTurn(decodeURIComponent(url.pathname.split('/').pop() ?? '')));
    }

    return json({ error: 'not_found' }, 404);
  }

  async alarm(): Promise<void> {
    const due = this.dueWorkflows(Date.now());
    for (const workflow of due) {
      this.sql.exec(
        `UPDATE workflow_state SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?`,
        Date.now(),
        Date.now(),
        workflow.id,
      );
    }
    await this.rescheduleAlarm();
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS nango_connections (
        integration_id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        provider_config_key TEXT NOT NULL,
        expires_at INTEGER,
        scopes TEXT,
        metadata TEXT,
        last_refresh_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        surface TEXT NOT NULL,
        surface_channel_id TEXT,
        bridge_session_id TEXT,
        user_id TEXT,
        status TEXT DEFAULT 'active',
        model TEXT,
        routing_tier TEXT,
        started_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        ended_at INTEGER,
        message_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_name TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, session_id UNINDEXED, timestamp UNINDEXED, tokenize = 'unicode61'
      );
      CREATE TABLE IF NOT EXISTS budget (
        period TEXT PRIMARY KEY,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        estimated_cost_usd REAL DEFAULT 0,
        budget_usd REAL DEFAULT 75.0,
        alert_sent_75_at INTEGER,
        alert_sent_90_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_state (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        trigger TEXT,
        status TEXT DEFAULT 'pending',
        payload TEXT,
        result TEXT,
        scheduled_at INTEGER,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS active_relay_turns (
        message_id TEXT PRIMARY KEY,
        session_key TEXT,
        surface_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        workflow_mode TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        roles_spawned TEXT,
        broker_reused INTEGER DEFAULT 0,
        final_summary TEXT
      );
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        source_session_id TEXT,
        confidence REAL DEFAULT 1.0,
        access_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content, type UNINDEXED, id UNINDEXED, tokenize = 'unicode61'
      );
    `);
  }

  private getOrCreateBridgeSession(input: Record<string, unknown>): Record<string, unknown> {
    const surface = stringValue(input.surface) ?? 'telegram';
    const channelId = stringValue(input.channelId) ?? 'unknown';
    const userId = stringValue(input.userId) ?? channelId;
    const bridgeSessionId = stringValue(input.existingBridgeId) ?? `user:${userId}`;
    const existing = this.sql.exec(
      `SELECT * FROM sessions WHERE bridge_session_id = ? AND surface = ? AND status = 'active'`,
      bridgeSessionId,
      surface,
    ).one();
    if (existing) return fromSessionRow(existing);

    const now = Date.now();
    const id = `${surface}:${channelId}:${now}`;
    this.sql.exec(
      `INSERT INTO sessions (id, surface, surface_channel_id, bridge_session_id, user_id, status, started_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      id,
      surface,
      channelId,
      bridgeSessionId,
      userId,
      now,
      now,
    );
    return fromSessionRow(this.sql.exec(`SELECT * FROM sessions WHERE id = ?`, id).one() ?? {});
  }

  private appendMessage(input: Record<string, unknown>): void {
    const id = stringValue(input.messageId) ?? crypto.randomUUID();
    const sessionId = stringValue(input.sessionId) ?? 'unknown';
    const role = stringValue(input.role) ?? 'user';
    const content = stringValue(input.content) ?? '';
    const timestamp = Date.now();
    this.sql.exec(
      `INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
      id,
      sessionId,
      role,
      content,
      timestamp,
    );
    this.sql.exec(
      `INSERT INTO messages_fts (content, session_id, timestamp) VALUES (?, ?, ?)`,
      content,
      sessionId,
      timestamp,
    );
    this.sql.exec(
      `UPDATE sessions SET message_count = message_count + 1, last_active_at = ? WHERE id = ?`,
      timestamp,
      sessionId,
    );
  }

  private searchMessages(query: string): Array<Record<string, unknown>> {
    return this.sql.exec(
      `SELECT role, id AS messageId, content AS text, timestamp AS createdAt
       FROM messages WHERE content LIKE ? ORDER BY timestamp DESC LIMIT 24`,
      `%${query}%`,
    ).toArray();
  }

  private checkAndRecordSpend(tokens: Record<string, unknown>): Record<string, unknown> {
    const period = new Date().toISOString().slice(0, 7);
    const input = numberValue(tokens.input);
    const output = numberValue(tokens.output);
    const cacheRead = numberValue(tokens.cacheRead);
    const cost = numberValue(tokens.estimatedCostUsd) || estimateTokenCostUsd(input, output, cacheRead);
    const row = this.sql.exec(
      `SELECT estimated_cost_usd, budget_usd FROM budget WHERE period = ?`,
      period,
    ).one() as Record<string, unknown> | null;
    const current = numberValue(row?.estimated_cost_usd);
    const limit = numberValue(row?.budget_usd) || 75;
    const projected = current + cost;
    if (projected > limit) {
      return { outcome: 'deny', reason: 'budget-exhausted', current, limit, projected };
    }
    this.sql.exec(
      `INSERT INTO budget (period, estimated_cost_usd, input_tokens, output_tokens, cache_read_tokens, budget_usd, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(period) DO UPDATE SET
         estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd,
         input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens,
         cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
         updated_at = excluded.updated_at`,
      period,
      cost,
      input,
      output,
      cacheRead,
      limit,
      Date.now(),
    );
    const ratio = projected / limit;
    return {
      outcome: 'allow',
      tier: ratio > 0.9 ? 'economy' : ratio > 0.75 ? 'standard' : 'premium',
      current,
      limit,
      projected,
    };
  }

  private getNangoConnection(integrationId: string): Record<string, unknown> | null {
    return this.sql.exec(
      `SELECT * FROM nango_connections WHERE integration_id = ?`,
      integrationId,
    ).one();
  }

  private upsertNangoConnection(input: Record<string, unknown>): void {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO nango_connections
       (integration_id, connection_id, provider_config_key, expires_at, scopes, metadata, last_refresh_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(integration_id) DO UPDATE SET
         connection_id = excluded.connection_id,
         provider_config_key = excluded.provider_config_key,
         expires_at = excluded.expires_at,
         scopes = excluded.scopes,
         metadata = excluded.metadata,
         last_refresh_at = excluded.last_refresh_at,
         updated_at = excluded.updated_at`,
      stringValue(input.integrationId),
      stringValue(input.connectionId),
      stringValue(input.providerConfigKey),
      numberValue(input.expiresAt),
      JSON.stringify(input.scopes ?? []),
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
      now,
    );
  }

  private putMemory(input: Record<string, unknown>): void {
    const id = stringValue(input.id) ?? crypto.randomUUID();
    const type = stringValue(input.type) ?? 'fact';
    const content = stringValue(input.content) ?? '';
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO memory (id, type, content, source_session_id, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET content = excluded.content, type = excluded.type`,
      id,
      type,
      content,
      stringValue(input.sourceSessionId),
      numberValue(input.confidence) || 1,
      now,
    );
    this.sql.exec(`INSERT INTO memory_fts (content, type, id) VALUES (?, ?, ?)`, content, type, id);
  }

  private searchMemory(query: string): Array<Record<string, unknown>> {
    return this.sql.exec(
      `SELECT id, type, content, source_session_id AS sourceSessionId, confidence
       FROM memory WHERE content LIKE ? ORDER BY created_at DESC LIMIT 24`,
      `%${query}%`,
    ).toArray();
  }

  private async putWorkflow(input: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO workflow_state (id, type, trigger, status, payload, result, scheduled_at, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         payload = excluded.payload,
         result = excluded.result,
         scheduled_at = excluded.scheduled_at,
         error = excluded.error,
         updated_at = excluded.updated_at`,
      stringValue(input.id) ?? crypto.randomUUID(),
      stringValue(input.type) ?? 'scheduled',
      stringValue(input.trigger),
      stringValue(input.status) ?? 'pending',
      JSON.stringify(input.payload ?? {}),
      JSON.stringify(input.result ?? null),
      numberValue(input.scheduledAt),
      stringValue(input.error),
      now,
      now,
    );
    await this.rescheduleAlarm();
  }

  private dueWorkflows(now: number): Array<Record<string, unknown>> {
    return this.sql.exec(
      `SELECT id, type, trigger, status, payload, result, scheduled_at AS scheduledAt, error
       FROM workflow_state
       WHERE status = 'pending' AND scheduled_at <= ?
       ORDER BY scheduled_at ASC`,
      now,
    ).toArray();
  }

  private putActiveRelayTurn(input: Record<string, unknown>): Record<string, unknown> {
    const messageId = stringValue(input.messageId) ?? crypto.randomUUID();
    const rolesSpawned = arrayStringValue(input.rolesSpawned);
    const record = {
      messageId,
      sessionKey: stringValue(input.sessionKey),
      surfaceId: stringValue(input.surfaceId) ?? 'unknown',
      targetId: stringValue(input.targetId) ?? 'unknown',
      workflowMode: stringValue(input.workflowMode) ?? 'orchestrated',
      lifecycleState: stringValue(input.lifecycleState) ?? 'working',
      startedAt: stringValue(input.startedAt) ?? new Date().toISOString(),
      updatedAt: stringValue(input.updatedAt) ?? new Date().toISOString(),
      completedAt: stringValue(input.completedAt),
      rolesSpawned,
      brokerReused: booleanValue(input.brokerReused),
      finalSummary: stringValue(input.finalSummary) ?? undefined,
    };

    this.sql.exec(
      `INSERT INTO active_relay_turns
       (message_id, session_key, surface_id, target_id, workflow_mode, lifecycle_state, started_at, updated_at,
        completed_at, roles_spawned, broker_reused, final_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         session_key = excluded.session_key,
         surface_id = excluded.surface_id,
         target_id = excluded.target_id,
         workflow_mode = excluded.workflow_mode,
         lifecycle_state = excluded.lifecycle_state,
         started_at = excluded.started_at,
         updated_at = excluded.updated_at,
         completed_at = excluded.completed_at,
         roles_spawned = excluded.roles_spawned,
         broker_reused = excluded.broker_reused,
         final_summary = excluded.final_summary`,
      record.messageId,
      record.sessionKey,
      record.surfaceId,
      record.targetId,
      record.workflowMode,
      record.lifecycleState,
      record.startedAt,
      record.updatedAt,
      record.completedAt,
      JSON.stringify(record.rolesSpawned),
      record.brokerReused ? 1 : 0,
      record.finalSummary,
    );

    return record;
  }

  private getActiveRelayTurn(messageId: string): Record<string, unknown> | null {
    const row = this.sql.exec(
      `SELECT message_id, session_key, surface_id, target_id, workflow_mode, lifecycle_state, started_at, updated_at,
              completed_at, roles_spawned, broker_reused, final_summary
       FROM active_relay_turns WHERE message_id = ?`,
      messageId,
    ).one();

    return row ? fromActiveRelayTurnRow(row) : null;
  }

  private async rescheduleAlarm(): Promise<void> {
    const next = this.sql.exec(
      `SELECT MIN(scheduled_at) AS next_at FROM workflow_state WHERE status = 'pending' AND scheduled_at IS NOT NULL`,
    ).one() as Record<string, unknown> | null;
    const nextAt = numberValue(next?.next_at);
    if (nextAt > 0) {
      await this.ctx.storage.setAlarm(nextAt);
    }
  }
}

function authorized(request: Request, env: Env): boolean {
  if (!env.KAREN_STATE_TOKEN) {
    return isLocalDevelopmentUrl(request.url);
  }
  return request.headers.get('authorization') === `Bearer ${env.KAREN_STATE_TOKEN}`;
}

function isLocalDevelopmentUrl(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function authMode(request: Request, env: Env): 'local-dev' | 'token' {
  return isLocalDevelopmentUrl(request.url) && !env.KAREN_STATE_TOKEN ? 'local-dev' : 'token';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fromSessionRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    surface: row.surface,
    surfaceChannelId: row.surface_channel_id,
    bridgeSessionId: row.bridge_session_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    lastActiveAt: row.last_active_at,
    messageCount: row.message_count,
  };
}

function fromActiveRelayTurnRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    messageId: row.message_id,
    sessionKey: row.session_key ?? null,
    surfaceId: row.surface_id,
    targetId: row.target_id,
    workflowMode: row.workflow_mode,
    lifecycleState: row.lifecycle_state,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
    rolesSpawned: parseJsonArray(row.roles_spawned),
    brokerReused: booleanValue(row.broker_reused),
    finalSummary: stringValue(row.final_summary) ?? undefined,
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function arrayStringValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return arrayStringValue(value);
  if (typeof value !== 'string') return [];
  try {
    return arrayStringValue(JSON.parse(value));
  } catch {
    return [];
  }
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return false;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function estimateTokenCostUsd(input: number, output: number, cacheRead: number): number {
  return (input * 0.000003) + (output * 0.000015) + (cacheRead * 0.0000003);
}
