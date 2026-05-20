import type { NangoConnection } from './state.js';

export type NangoWebhookEvent = {
  type: string;
  connection: NangoConnection;
  receivedAt: string;
  raw: Record<string, unknown>;
};

export function normalizeNangoWebhook(payload: unknown): NangoWebhookEvent | null {
  const root = asRecord(payload);
  if (!root) return null;
  const connection = firstRecord(root.connection, root.data, root.payload, root);
  const integrationId = stringValue(connection.integration_id) ??
    stringValue(connection.integrationId) ??
    stringValue(connection.integration) ??
    stringValue(connection.provider) ??
    stringValue(connection.provider_config_key) ??
    stringValue(connection.providerConfigKey);
  const connectionId = stringValue(connection.connection_id) ??
    stringValue(connection.connectionId) ??
    stringValue(connection.nango_connection_id) ??
    stringValue(connection.nangoConnectionId);
  const providerConfigKey = stringValue(connection.provider_config_key) ??
    stringValue(connection.providerConfigKey) ??
    integrationId;
  if (!integrationId || !connectionId || !providerConfigKey) {
    return null;
  }

  return {
    type: stringValue(root.type) ??
      stringValue(root.event) ??
      stringValue(root.operation) ??
      'connection.updated',
    connection: {
      integrationId,
      connectionId,
      providerConfigKey,
      expiresAt: numberValue(connection.expires_at) ?? numberValue(connection.expiresAt),
      scopes: stringArray(connection.scopes),
      metadata: {
        ...(asRecord(connection.metadata) ?? {}),
        ...(asRecord(root.end_user) ? { endUser: asRecord(root.end_user) } : {}),
        ...(asRecord(root.endUser) ? { endUser: asRecord(root.endUser) } : {}),
      },
    },
    receivedAt: new Date().toISOString(),
    raw: root,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return {};
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
