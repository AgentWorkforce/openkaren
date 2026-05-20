import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpenKarenConfig } from './types.js';

export const RELAY_LIFECYCLE_STATES = [
  'accepted',
  'dispatched',
  'working',
  'completed',
  'timed_out',
  'failed_to_start',
  'failed_during_execution',
] as const;

export type RelayLifecycleState = typeof RELAY_LIFECYCLE_STATES[number];

export type RelayRunWaitStatus = 'idle' | 'timeout' | 'exited' | 'failed_to_start' | 'failed_during_execution';

export type RelayRunArtifact = {
  messageId: string;
  sessionKey: string;
  workflowMode: OpenKarenConfig['agentRelayWorkflow'];
  rolesSpawned: string[];
  modelsOrPersonas: string[];
  brokerReused: boolean;
  startedAt: string;
  completedAt: string;
  waitStatus: RelayRunWaitStatus;
  finalSummary: string;
};

export function relayRunsDir(config: Pick<OpenKarenConfig, 'dataDir'>): string {
  return join(config.dataDir, 'runs');
}

export async function writeRelayRunArtifact(
  config: Pick<OpenKarenConfig, 'dataDir'>,
  artifact: RelayRunArtifact,
): Promise<string> {
  const runsDir = relayRunsDir(config);
  await mkdir(runsDir, { recursive: true });
  const path = join(runsDir, relayRunFilename(artifact));
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`);
  return path;
}

export function readLastRelayRun(config: Pick<OpenKarenConfig, 'dataDir'>): RelayRunArtifact | null {
  const runsDir = relayRunsDir(config);
  if (!existsSync(runsDir)) {
    return null;
  }

  const candidates = readdirSync(runsDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  for (const filename of candidates.reverse()) {
    const parsed = parseRelayRunArtifact(readFileSync(join(runsDir, filename), 'utf8'));
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

export function relayRunSummaryLines(artifact: RelayRunArtifact | null): string[] {
  if (!artifact) {
    return ['last relay run: none'];
  }

  return [
    `last relay run: ${artifact.waitStatus} (${artifact.completedAt})`,
    `last relay lifecycle: ${waitStatusLifecycleLabel(artifact.waitStatus)}`,
    `last relay message: ${artifact.messageId}`,
    `last relay session: ${artifact.sessionKey}`,
    `last relay workflow: ${artifact.workflowMode}`,
    `last relay roles: ${artifact.rolesSpawned.length ? artifact.rolesSpawned.join(', ') : 'none'}`,
    `last relay broker: ${artifact.brokerReused ? 'reused' : 'fresh'}`,
    `last relay summary: ${compactSummary(artifact.finalSummary)}`,
  ];
}

export function relayLifecycleLabel(state: RelayLifecycleState): string {
  switch (state) {
    case 'accepted':
      return 'accepted';
    case 'dispatched':
      return 'dispatched through relay';
    case 'working':
      return 'still working';
    case 'completed':
      return 'completed';
    case 'timed_out':
      return 'timed out';
    case 'failed_to_start':
      return 'failed to start';
    case 'failed_during_execution':
      return 'failed during execution';
  }
}

function relayRunFilename(artifact: RelayRunArtifact): string {
  const timestamp = artifact.startedAt.replace(/[^0-9TZ]/g, '').slice(0, 20) || String(Date.now());
  const messageId = artifact.messageId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'message';
  return `${timestamp}-${messageId}.json`;
}

function parseRelayRunArtifact(text: string): RelayRunArtifact | null {
  try {
    const parsed = JSON.parse(text) as Partial<RelayRunArtifact>;
    if (
      typeof parsed.messageId === 'string' &&
      typeof parsed.sessionKey === 'string' &&
      (parsed.workflowMode === 'single' || parsed.workflowMode === 'orchestrated') &&
      Array.isArray(parsed.rolesSpawned) &&
      parsed.rolesSpawned.every((role) => typeof role === 'string') &&
      Array.isArray(parsed.modelsOrPersonas) &&
      parsed.modelsOrPersonas.every((model) => typeof model === 'string') &&
      typeof parsed.brokerReused === 'boolean' &&
      typeof parsed.startedAt === 'string' &&
      typeof parsed.completedAt === 'string' &&
      typeof parsed.waitStatus === 'string' &&
      typeof parsed.finalSummary === 'string'
    ) {
      return parsed as RelayRunArtifact;
    }
  } catch {
    return null;
  }

  return null;
}

function compactSummary(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'none';
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function waitStatusLifecycleLabel(waitStatus: RelayRunWaitStatus): string {
  if (waitStatus === 'timeout') {
    return relayLifecycleLabel('timed_out');
  }

  if (waitStatus === 'failed_to_start' || waitStatus === 'failed_during_execution') {
    return relayLifecycleLabel(waitStatus);
  }

  return relayLifecycleLabel('completed');
}
