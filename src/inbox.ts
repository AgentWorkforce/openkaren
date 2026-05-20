export type OpenKarenInboxEvent = {
  source: string;
  provider: 'n8n' | 'pipedream' | 'composio' | 'webhook';
  eventType: string;
  externalId?: string;
  text: string;
  receivedAt: string;
  raw: Record<string, unknown>;
};

export const INBOX_WEBHOOK_PATH = '/webhooks/inbox';

export function normalizeInboxWebhook(payload: unknown): OpenKarenInboxEvent | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const nested = candidateRecords(root);
  const provider = detectProvider(root, nested);
  const source = stringValue(root.source) ??
    stringValue(root.provider) ??
    stringValue(root.integration) ??
    provider;
  const text = firstString(
    root.text,
    root.summary,
    root.title,
    root.message,
    root.description,
    ...nested.flatMap((record) => [
      record.text,
      record.summary,
      record.title,
      record.message,
      record.description,
      record.name,
    ]),
  );

  if (!text) {
    return null;
  }

  return {
    source,
    provider,
    eventType: firstString(
      root.type,
      root.event_type,
      root.eventType,
      root.event,
      ...nested.flatMap((record) => [record.type, record.event, record.event_type, record.eventType]),
    ) ??
      'automation.event',
    externalId: firstString(root.id, root.event_id, root.eventId, root.workflow_id, ...nested.map((record) => record.id)) ??
      undefined,
    text,
    receivedAt: new Date().toISOString(),
    raw: root,
  };
}

export function inboxEventText(event: OpenKarenInboxEvent): string {
  return `Inbox/${event.provider}/${event.source}: ${compact(event.text, 240)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function candidateRecords(root: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [
    root.body,
    root.payload,
    root.data,
    root.event,
    asRecord(root.payload)?.body,
    asRecord(root.payload)?.data,
    asRecord(root.payload)?.event,
    asRecord(root.data)?.body,
    asRecord(root.data)?.payload,
    asRecord(root.data)?.event,
    asRecord(root.event)?.body,
    asRecord(root.event)?.data,
    asRecord(root.event)?.payload,
    asRecord(root.steps)?.trigger,
    asRecord(asRecord(root.steps)?.trigger)?.event,
    asRecord(asRecord(asRecord(root.steps)?.trigger)?.event)?.body,
  ];
  return candidates
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => Boolean(record));
}

function detectProvider(
  root: Record<string, unknown>,
  nested: readonly Record<string, unknown>[],
): OpenKarenInboxEvent['provider'] {
  const haystack = [
    root.source,
    root.provider,
    root.integration,
    root.workflow_id,
    root.workflowId,
    root.pipedream,
    root.composio,
    ...nested.flatMap((record) => [
      record.source,
      record.provider,
      record.integration,
      record.workflow_id,
      record.workflowId,
      record.pipedream,
      record.composio,
    ]),
  ].map((value) => String(value ?? '').toLowerCase());

  if (haystack.some((value) => value.includes('composio'))) {
    return 'composio';
  }
  if (haystack.some((value) => value.includes('pipedream') || value.includes('pd_'))) {
    return 'pipedream';
  }
  if (haystack.some((value) => value.includes('n8n'))) {
    return 'n8n';
  }
  return 'webhook';
}

function compact(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 3)}...`
    : normalized;
}
