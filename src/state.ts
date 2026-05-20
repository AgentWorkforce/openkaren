import type { RelayLifecycleState } from './relay-evidence.js';
import type { ConversationMessage, OpenKarenConfig } from './types.js';
import { createBridgeSessionId } from './identity-bridge.js';
import { redactError, redactSecretText } from './redaction.js';

export type BudgetTokens = {
  input: number;
  output: number;
  cacheRead?: number;
  estimatedCostUsd?: number;
};

export type BudgetDecision =
  | {
    outcome: 'deny';
    reason: 'budget-exhausted';
    current: number;
    limit: number;
    projected: number;
  }
  | {
    outcome: 'allow';
    tier: 'premium' | 'standard' | 'economy';
    current: number;
    limit: number;
    projected: number;
  };

export type BridgeSession = {
  id: string;
  surface: string;
  surfaceChannelId: string;
  bridgeSessionId: string;
  userId: string;
  status: 'active' | 'ended';
  startedAt: number;
  lastActiveAt: number;
  messageCount: number;
};

export type NangoConnection = {
  integrationId: string;
  connectionId: string;
  providerConfigKey: string;
  expiresAt?: number | null;
  scopes?: string[];
  metadata?: Record<string, unknown>;
};

export type WorkflowStateRecord = {
  id: string;
  type: 'watch' | 'scheduled' | 'delegation' | 'continuation';
  trigger?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  scheduledAt?: number;
  error?: string;
};

export type ActiveRelayTurnLifecycleRecord = {
  messageId: string;
  sessionKey?: string | null;
  surfaceId: string;
  targetId: string;
  workflowMode: OpenKarenConfig['agentRelayWorkflow'];
  lifecycleState: RelayLifecycleState;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
  rolesSpawned?: string[];
  brokerReused?: boolean;
  finalSummary?: string;
};

export type MemoryRecord = {
  id: string;
  type: 'preference' | 'fact' | 'workflow-pattern';
  content: string;
  sourceSessionId?: string;
  confidence?: number;
};

export type KarenStateClient = {
  getOrCreateBridgeSession(input: {
    surface: 'telegram' | 'slack' | 'relaycast';
    channelId: string;
    userId: string;
    existingBridgeId?: string;
  }): Promise<BridgeSession>;
  appendMessage(input: {
    sessionId: string;
    role: ConversationMessage['role'] | 'tool';
    content: string;
    messageId?: string;
    tokenUsage?: BudgetTokens;
  }): Promise<void>;
  searchMessages(query: string): Promise<ConversationMessage[]>;
  checkAndRecordSpend(tokens: BudgetTokens): Promise<BudgetDecision>;
  getNangoConnection(integrationId: string): Promise<NangoConnection | null>;
  upsertNangoConnection(connection: NangoConnection): Promise<void>;
  putMemory(memory: MemoryRecord): Promise<void>;
  searchMemory(query: string): Promise<MemoryRecord[]>;
  putWorkflow(record: WorkflowStateRecord): Promise<void>;
  dueWorkflows(now?: number): Promise<WorkflowStateRecord[]>;
  putActiveRelayTurn(record: ActiveRelayTurnLifecycleRecord): Promise<void>;
  getActiveRelayTurn(messageId: string): Promise<ActiveRelayTurnLifecycleRecord | null>;
};

export function createKarenStateClient(config: OpenKarenConfig): KarenStateClient {
  if (config.stateWorkerUrl) {
    return new FallbackKarenStateClient(new HttpKarenStateClient(config), new InMemoryKarenStateClient(config));
  }

  return new InMemoryKarenStateClient(config);
}

class FallbackKarenStateClient implements KarenStateClient {
  private warned = false;

  constructor(
    private readonly primary: KarenStateClient,
    private readonly fallback: KarenStateClient,
  ) {}

  getOrCreateBridgeSession(input: {
    surface: 'telegram' | 'slack' | 'relaycast';
    channelId: string;
    userId: string;
    existingBridgeId?: string;
  }): Promise<BridgeSession> {
    return this.withFallback('getOrCreateBridgeSession', () => this.primary.getOrCreateBridgeSession(input), () =>
      this.fallback.getOrCreateBridgeSession(input),
    );
  }

  appendMessage(input: {
    sessionId: string;
    role: ConversationMessage['role'] | 'tool';
    content: string;
    messageId?: string;
    tokenUsage?: BudgetTokens;
  }): Promise<void> {
    return this.withFallback('appendMessage', () => this.primary.appendMessage(input), () =>
      this.fallback.appendMessage(input),
    );
  }

  searchMessages(query: string): Promise<ConversationMessage[]> {
    return this.withFallback('searchMessages', () => this.primary.searchMessages(query), () =>
      this.fallback.searchMessages(query),
    );
  }

  checkAndRecordSpend(tokens: BudgetTokens): Promise<BudgetDecision> {
    return this.withFallback('checkAndRecordSpend', () => this.primary.checkAndRecordSpend(tokens), () =>
      this.fallback.checkAndRecordSpend(tokens),
    );
  }

  getNangoConnection(integrationId: string): Promise<NangoConnection | null> {
    return this.withFallback('getNangoConnection', () => this.primary.getNangoConnection(integrationId), () =>
      this.fallback.getNangoConnection(integrationId),
    );
  }

  upsertNangoConnection(connection: NangoConnection): Promise<void> {
    return this.withFallback('upsertNangoConnection', () => this.primary.upsertNangoConnection(connection), () =>
      this.fallback.upsertNangoConnection(connection),
    );
  }

  putMemory(memory: MemoryRecord): Promise<void> {
    return this.withFallback('putMemory', () => this.primary.putMemory(memory), () =>
      this.fallback.putMemory(memory),
    );
  }

  searchMemory(query: string): Promise<MemoryRecord[]> {
    return this.withFallback('searchMemory', () => this.primary.searchMemory(query), () =>
      this.fallback.searchMemory(query),
    );
  }

  putWorkflow(record: WorkflowStateRecord): Promise<void> {
    return this.withFallback('putWorkflow', () => this.primary.putWorkflow(record), () =>
      this.fallback.putWorkflow(record),
    );
  }

  dueWorkflows(now?: number): Promise<WorkflowStateRecord[]> {
    return this.withFallback('dueWorkflows', () => this.primary.dueWorkflows(now), () =>
      this.fallback.dueWorkflows(now),
    );
  }

  putActiveRelayTurn(record: ActiveRelayTurnLifecycleRecord): Promise<void> {
    return this.withFallback('putActiveRelayTurn', () => this.primary.putActiveRelayTurn(record), () =>
      this.fallback.putActiveRelayTurn(record),
    );
  }

  getActiveRelayTurn(messageId: string): Promise<ActiveRelayTurnLifecycleRecord | null> {
    return this.withFallback('getActiveRelayTurn', () => this.primary.getActiveRelayTurn(messageId), () =>
      this.fallback.getActiveRelayTurn(messageId),
    );
  }

  private async withFallback<T>(
    operation: string,
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.warn('OpenKaren state worker unavailable; falling back to local in-memory state', {
          operation,
          error: redactError(error),
        });
      }
      return await fallback();
    }
  }
}

class HttpKarenStateClient implements KarenStateClient {
  private readonly baseUrl: string;

  constructor(private readonly config: OpenKarenConfig) {
    this.baseUrl = config.stateWorkerUrl?.replace(/\/+$/, '') ?? '';
  }

  getOrCreateBridgeSession(input: {
    surface: 'telegram' | 'slack' | 'relaycast';
    channelId: string;
    userId: string;
    existingBridgeId?: string;
  }): Promise<BridgeSession> {
    return this.request('/sessions', { method: 'POST', body: input });
  }

  async appendMessage(input: {
    sessionId: string;
    role: ConversationMessage['role'] | 'tool';
    content: string;
    messageId?: string;
    tokenUsage?: BudgetTokens;
  }): Promise<void> {
    await this.request('/messages', { method: 'POST', body: input });
  }

  searchMessages(query: string): Promise<ConversationMessage[]> {
    return this.request(`/search/messages?q=${encodeURIComponent(query)}`, { method: 'GET' });
  }

  checkAndRecordSpend(tokens: BudgetTokens): Promise<BudgetDecision> {
    return this.request('/budget/check-and-record', { method: 'POST', body: tokens });
  }

  getNangoConnection(integrationId: string): Promise<NangoConnection | null> {
    return this.request(`/nango-connection/${encodeURIComponent(integrationId)}`, { method: 'GET' });
  }

  async upsertNangoConnection(connection: NangoConnection): Promise<void> {
    await this.request('/nango-connection', { method: 'POST', body: connection });
  }

  async putMemory(memory: MemoryRecord): Promise<void> {
    await this.request('/memory', { method: 'POST', body: memory });
  }

  searchMemory(query: string): Promise<MemoryRecord[]> {
    return this.request(`/search/memory?q=${encodeURIComponent(query)}`, { method: 'GET' });
  }

  async putWorkflow(record: WorkflowStateRecord): Promise<void> {
    await this.request('/workflow', { method: 'POST', body: record });
  }

  dueWorkflows(now = Date.now()): Promise<WorkflowStateRecord[]> {
    return this.request(`/workflow/due?now=${now}`, { method: 'GET' });
  }

  async putActiveRelayTurn(record: ActiveRelayTurnLifecycleRecord): Promise<void> {
    await this.request('/relay/active-turn', { method: 'POST', body: record });
  }

  getActiveRelayTurn(messageId: string): Promise<ActiveRelayTurnLifecycleRecord | null> {
    return this.request(`/relay/active-turn/${encodeURIComponent(messageId)}`, { method: 'GET' });
  }

  private async request<T>(
    path: string,
    input: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: input.method,
      headers: {
        'content-type': 'application/json',
        ...(this.config.stateWorkerAuthToken
          ? { authorization: `Bearer ${this.config.stateWorkerAuthToken}` }
          : {}),
        'x-openkaren-user-id': this.config.stateUserId,
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    if (!response.ok) {
      throw new Error(redactSecretText(`Karen state ${path} failed with ${response.status}: ${await response.text()}`));
    }
    return await response.json() as T;
  }
}

export class InMemoryKarenStateClient implements KarenStateClient {
  private readonly sessions = new Map<string, BridgeSession>();
  private readonly messages: ConversationMessage[] = [];
  private readonly connections = new Map<string, NangoConnection>();
  private readonly memories = new Map<string, MemoryRecord>();
  private readonly workflows = new Map<string, WorkflowStateRecord>();
  private readonly activeRelayTurns = new Map<string, ActiveRelayTurnLifecycleRecord>();
  private spendUsd = 0;

  constructor(
    private readonly config: Pick<OpenKarenConfig, 'monthlyBudgetUsd'> &
      Partial<Pick<OpenKarenConfig, 'identityBridgeMappings'>>,
  ) {}

  async getOrCreateBridgeSession(input: {
    surface: 'telegram' | 'slack' | 'relaycast';
    channelId: string;
    userId: string;
    existingBridgeId?: string;
  }): Promise<BridgeSession> {
    const bridgeSessionId = input.existingBridgeId ??
      createBridgeSessionId(input, this.config.identityBridgeMappings);
    const existing = [...this.sessions.values()].find((session) =>
      session.bridgeSessionId === bridgeSessionId &&
      session.surface === input.surface &&
      session.status === 'active'
    );
    if (existing) {
      existing.lastActiveAt = Date.now();
      return existing;
    }

    const now = Date.now();
    const session: BridgeSession = {
      id: `${input.surface}:${input.channelId}:${now}`,
      surface: input.surface,
      surfaceChannelId: input.channelId,
      bridgeSessionId,
      userId: input.userId,
      status: 'active',
      startedAt: now,
      lastActiveAt: now,
      messageCount: 0,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async appendMessage(input: {
    sessionId: string;
    role: ConversationMessage['role'] | 'tool';
    content: string;
    messageId?: string;
  }): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (session) {
      session.messageCount += 1;
      session.lastActiveAt = Date.now();
    }
    if (input.role === 'tool') return;
    this.messages.push({
      role: input.role,
      messageId: input.messageId ?? `${input.sessionId}:${this.messages.length}`,
      text: input.content,
      createdAt: new Date().toISOString(),
    });
  }

  async searchMessages(query: string): Promise<ConversationMessage[]> {
    const normalized = query.toLowerCase().trim();
    if (!normalized) {
      return [...this.messages];
    }
    return this.messages.filter((message) => message.text.toLowerCase().includes(normalized));
  }

  async checkAndRecordSpend(tokens: BudgetTokens): Promise<BudgetDecision> {
    const cost = tokens.estimatedCostUsd ?? estimateTokenCostUsd(tokens);
    const projected = this.spendUsd + cost;
    const limit = this.config.monthlyBudgetUsd;
    if (projected > limit) {
      return { outcome: 'deny', reason: 'budget-exhausted', current: this.spendUsd, limit, projected };
    }
    this.spendUsd = projected;
    const ratio = projected / limit;
    const tier = ratio > 0.9 ? 'economy' : ratio > 0.75 ? 'standard' : 'premium';
    return { outcome: 'allow', tier, current: projected - cost, limit, projected };
  }

  async getNangoConnection(integrationId: string): Promise<NangoConnection | null> {
    return this.connections.get(integrationId) ?? null;
  }

  async upsertNangoConnection(connection: NangoConnection): Promise<void> {
    this.connections.set(connection.integrationId, connection);
  }

  async putMemory(memory: MemoryRecord): Promise<void> {
    this.memories.set(memory.id, memory);
  }

  async searchMemory(query: string): Promise<MemoryRecord[]> {
    const normalized = query.toLowerCase();
    return [...this.memories.values()].filter((memory) => memory.content.toLowerCase().includes(normalized));
  }

  async putWorkflow(record: WorkflowStateRecord): Promise<void> {
    this.workflows.set(record.id, record);
  }

  async dueWorkflows(now = Date.now()): Promise<WorkflowStateRecord[]> {
    return [...this.workflows.values()]
      .filter((workflow) =>
        workflow.status === 'pending' &&
        workflow.scheduledAt !== undefined &&
        workflow.scheduledAt <= now
      )
      .sort((left, right) => (left.scheduledAt ?? 0) - (right.scheduledAt ?? 0));
  }

  async putActiveRelayTurn(record: ActiveRelayTurnLifecycleRecord): Promise<void> {
    this.activeRelayTurns.set(record.messageId, cloneActiveRelayTurn(record));
  }

  async getActiveRelayTurn(messageId: string): Promise<ActiveRelayTurnLifecycleRecord | null> {
    const record = this.activeRelayTurns.get(messageId);
    return record ? cloneActiveRelayTurn(record) : null;
  }
}

function cloneActiveRelayTurn(record: ActiveRelayTurnLifecycleRecord): ActiveRelayTurnLifecycleRecord {
  return {
    ...record,
    rolesSpawned: record.rolesSpawned ? [...record.rolesSpawned] : undefined,
  };
}

function estimateTokenCostUsd(tokens: BudgetTokens): number {
  const input = Math.max(0, tokens.input);
  const output = Math.max(0, tokens.output);
  const cacheRead = Math.max(0, tokens.cacheRead ?? 0);
  return (input * 0.000003) + (output * 0.000015) + (cacheRead * 0.0000003);
}
