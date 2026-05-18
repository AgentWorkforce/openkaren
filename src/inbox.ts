export type OpenKarenInboxEvent = {
  source: string;
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

  const source = stringValue(root.source) ??
    stringValue(root.provider) ??
    stringValue(root.integration) ??
    'webhook';
  const text = stringValue(root.text) ??
    stringValue(root.summary) ??
    stringValue(root.title) ??
    stringValue(asRecord(root.event)?.title) ??
    stringValue(asRecord(root.data)?.title);

  if (!text) {
    return null;
  }

  return {
    source,
    text,
    receivedAt: new Date().toISOString(),
    raw: root,
  };
}

export function inboxEventText(event: OpenKarenInboxEvent): string {
  return `Inbox/${event.source}: ${compact(event.text, 240)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function compact(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars - 3)}...`
    : normalized;
}
