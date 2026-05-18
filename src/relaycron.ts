import type { OpenKarenConfig } from './types.js';

const DEFAULT_RELAYCRON_WEBHOOK_PATH = '/webhooks/relaycron';
const RELAYCRON_HTTP_TIMEOUT_MS = 5_000;

export type RelayCronProgressTurn = {
  messageId: string;
  targetId: string;
  surfaceId: string;
  startedAt: string;
  mode: OpenKarenConfig['agentMode'];
  text: string;
};

export type RelayCronProactiveTurn = {
  scheduleName: string;
  targetId: string;
  surfaceId: string;
  firedAt: string;
};

export type RelayCronProgressHandle = {
  enabled: boolean;
  scheduleId?: string;
  stop(): Promise<void>;
};

export type RelayCronWebhookPayload = Record<string, unknown>;

const DEFAULT_PROACTIVE_SCHEDULES = [
  {
    name: 'daily-standup',
    cron: '0 9 * * 1-5',
    description: 'weekday repo and integration standup',
  },
  {
    name: 'weekly-spend-review',
    cron: '0 17 * * 5',
    description: 'Friday token spend review',
  },
  {
    name: 'workflow-health-check',
    cron: '*/30 * * * *',
    description: 'lightweight workflow health check',
  },
] as const;

type ProactiveScheduleName = typeof DEFAULT_PROACTIVE_SCHEDULES[number]['name'];
type CreatedProactiveSchedule = {
  name: ProactiveScheduleName;
  id: string;
};

export async function startRelayCronProgress(
  config: OpenKarenConfig,
  turn: RelayCronProgressTurn,
): Promise<RelayCronProgressHandle> {
  if (
    config.agentMode !== 'relay' ||
    !config.relaycronBaseUrl ||
    !config.relaycronApiKey ||
    !config.relaycronWebhookUrl
  ) {
    return disabledHandle();
  }

  const schedule = await createRelayCronSchedule(config, turn).catch((error: unknown) => {
    console.warn('OpenKaren RelayCron progress schedule failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!schedule?.id) {
    return disabledHandle();
  }
  const scheduleId = schedule.id;

  console.info('OpenKaren RelayCron progress schedule started', {
    scheduleId,
    messageId: turn.messageId,
  });

  return {
    enabled: true,
    scheduleId,
    async stop() {
      await cancelRelayCronSchedule(config, scheduleId).catch((error: unknown) => {
        console.warn('OpenKaren RelayCron progress cancel failed', {
          scheduleId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  };
}

export async function startRelayCronProactiveSchedules(
  config: OpenKarenConfig,
  target: { surfaceId: string; targetId: string } | null,
): Promise<RelayCronProgressHandle> {
  if (
    !target ||
    !config.relaycronBaseUrl ||
    !config.relaycronApiKey ||
    !config.relaycronWebhookUrl
  ) {
    return disabledHandle();
  }

  const schedules = await Promise.all(
    DEFAULT_PROACTIVE_SCHEDULES.map(async (schedule) => {
      const created = await createRelayCronProactiveSchedule(config, schedule, target).catch(
        (error: unknown) => {
          console.warn('OpenKaren RelayCron proactive schedule failed', {
            schedule: schedule.name,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        },
      );
      return created?.id ? { name: schedule.name, id: created.id } : null;
    }),
  );

  const enabledSchedules = schedules.filter(isCreatedProactiveSchedule);
  if (!enabledSchedules.length) {
    return disabledHandle();
  }

  console.info('OpenKaren RelayCron proactive schedules started', {
    schedules: enabledSchedules.map((schedule) => schedule.name),
  });

  return {
    enabled: true,
    scheduleId: enabledSchedules.map((schedule) => schedule.id).join(','),
    async stop() {
      await Promise.all(
        enabledSchedules.map(async (schedule) => {
          await cancelRelayCronSchedule(config, schedule.id).catch((error: unknown) => {
            console.warn('OpenKaren RelayCron proactive cancel failed', {
              schedule: schedule.name,
              scheduleId: schedule.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }),
      );
    },
  };
}

async function createRelayCronSchedule(
  config: OpenKarenConfig,
  turn: RelayCronProgressTurn,
): Promise<{ id?: string }> {
  const response = await relayCronFetch(`${config.relaycronBaseUrl}/v1/schedules`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.relaycronApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: scheduleName(turn),
      schedule_type: 'cron',
      cron_expression: '*/2 * * * *',
      payload: {
        type: 'openkaren.progress_check',
        messageId: turn.messageId,
        targetId: turn.targetId,
        surfaceId: turn.surfaceId,
        startedAt: turn.startedAt,
        mode: turn.mode,
        text: turn.text,
      },
      transport: {
        type: 'webhook',
        url: config.relaycronWebhookUrl,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`RelayCron schedule create failed with ${response.status}`);
  }

  return { id: scheduleIdFromResponse(await response.json()) };
}

async function createRelayCronProactiveSchedule(
  config: OpenKarenConfig,
  schedule: typeof DEFAULT_PROACTIVE_SCHEDULES[number],
  target: { surfaceId: string; targetId: string },
): Promise<{ id?: string }> {
  const response = await relayCronFetch(`${config.relaycronBaseUrl}/v1/schedules`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.relaycronApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: `openkaren-${schedule.name}`,
      schedule_type: 'cron',
      cron_expression: schedule.cron,
      payload: {
        type: 'openkaren.proactive_tick',
        scheduleName: schedule.name,
        description: schedule.description,
        targetId: target.targetId,
        surfaceId: target.surfaceId,
      },
      transport: {
        type: 'webhook',
        url: config.relaycronWebhookUrl,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`RelayCron proactive schedule create failed with ${response.status}`);
  }

  return { id: scheduleIdFromResponse(await response.json()) };
}

async function cancelRelayCronSchedule(
  config: OpenKarenConfig,
  scheduleId: string,
): Promise<void> {
  const response = await relayCronFetch(
    `${config.relaycronBaseUrl}/v1/schedules/${encodeURIComponent(scheduleId)}/cancel`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.relaycronApiKey}`,
        'content-type': 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`RelayCron schedule cancel failed with ${response.status}`);
  }
}

function relayCronFetch(input: string, init: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(RELAYCRON_HTTP_TIMEOUT_MS),
  });
}

function scheduleIdFromResponse(payload: unknown): string | undefined {
  const root = asRecord(payload);
  return normalizeString(root?.id) ?? normalizeString(asRecord(root?.data)?.id);
}

function disabledHandle(): RelayCronProgressHandle {
  return {
    enabled: false,
    async stop() {},
  };
}

function scheduleName(turn: RelayCronProgressTurn): string {
  const safeId = turn.messageId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
  return `openkaren-progress-${safeId}`;
}

function isCreatedProactiveSchedule(
  schedule: CreatedProactiveSchedule | null,
): schedule is CreatedProactiveSchedule {
  return Boolean(schedule);
}

export function relayCronWebhookPath(config: Pick<OpenKarenConfig, 'relaycronWebhookUrl'>): string {
  if (!config.relaycronWebhookUrl) {
    return DEFAULT_RELAYCRON_WEBHOOK_PATH;
  }

  try {
    const parsed = new URL(config.relaycronWebhookUrl);
    return parsed.pathname || DEFAULT_RELAYCRON_WEBHOOK_PATH;
  } catch {
    return DEFAULT_RELAYCRON_WEBHOOK_PATH;
  }
}

export function relayCronProgressConfigured(
  config: Pick<
    OpenKarenConfig,
    'agentMode' | 'relaycronBaseUrl' | 'relaycronApiKey' | 'relaycronWebhookUrl'
  >,
): boolean {
  return Boolean(
    config.agentMode === 'relay' &&
      config.relaycronBaseUrl &&
      config.relaycronApiKey &&
      config.relaycronWebhookUrl,
  );
}

export function relayCronWebhookConfigured(
  config: Pick<OpenKarenConfig, 'relaycronBaseUrl' | 'relaycronApiKey' | 'relaycronWebhookUrl'>,
): boolean {
  return Boolean(config.relaycronBaseUrl && config.relaycronApiKey && config.relaycronWebhookUrl);
}

export function normalizeRelayCronProgressPayload(
  payload: unknown,
): RelayCronProgressTurn | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const source = asRecord(root.payload) ?? root;
  if (source.type !== 'openkaren.progress_check') {
    return null;
  }

  const messageId = normalizeString(source.messageId);
  const targetId = normalizeString(source.targetId);
  const surfaceId = normalizeString(source.surfaceId);
  const startedAt = normalizeString(source.startedAt);
  const mode = normalizeString(source.mode);

  if (
    !messageId ||
    !targetId ||
    !surfaceId ||
    !startedAt ||
    (mode !== 'relay' && mode !== 'command' && mode !== 'queue')
  ) {
    return null;
  }

  return {
    messageId,
    targetId,
    surfaceId,
    startedAt,
    mode,
    text: normalizeString(source.text) ?? '',
  };
}

export function normalizeRelayCronProactivePayload(
  payload: unknown,
): RelayCronProactiveTurn | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const source = asRecord(root.payload) ?? root;
  if (source.type !== 'openkaren.proactive_tick') {
    return null;
  }

  const scheduleName = normalizeString(source.scheduleName);
  const targetId = normalizeString(source.targetId);
  const surfaceId = normalizeString(source.surfaceId);
  if (!scheduleName || !targetId || !surfaceId) {
    return null;
  }

  return {
    scheduleName,
    targetId,
    surfaceId,
    firedAt: new Date().toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
