import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenKarenConfig } from './types.js';

export type WorkforceRole = 'worker' | 'planner' | 'implementer' | 'reviewer' | 'verifier';

type PersonaJson = {
  id?: unknown;
  intent?: unknown;
  description?: unknown;
  tiers?: Record<string, {
    harness?: unknown;
    model?: unknown;
    systemPrompt?: unknown;
  }>;
};

const ROLE_PERSONA: Record<WorkforceRole, string> = {
  worker: 'debugger',
  planner: 'architecture-planner',
  implementer: 'debugger',
  reviewer: 'code-reviewer',
  verifier: 'verifier',
};

export function workforcePromptForRole(
  config: OpenKarenConfig,
  role: WorkforceRole,
  spend?: { remainingRatio: number | null },
): string {
  const persona = loadPersona(config, role);
  if (!persona) {
    return [
      'Workforce persona:',
      `- role: ${role}`,
      `- state: missing (${join(config.workforcePersonaDir, `${ROLE_PERSONA[role]}.json`)})`,
    ].join('\n');
  }

  const tierName = chooseTier(persona, spend);
  const tier = tierName ? persona.tiers?.[tierName] : null;
  const lines = [
    'Workforce persona:',
    `- role: ${role}`,
    `- persona: ${stringValue(persona.id) ?? ROLE_PERSONA[role]}`,
    `- intent: ${stringValue(persona.intent) ?? 'unknown'}`,
    `- tier: ${tierName ?? 'unresolved'}`,
  ];

  const model = stringValue(tier?.model);
  if (model) {
    lines.push(`- model: ${model}`);
  }

  const systemPrompt = stringValue(tier?.systemPrompt);
  if (systemPrompt) {
    lines.push(`- system prompt: ${compact(systemPrompt, 1_200)}`);
  }

  return lines.join('\n');
}

export function workforceModelForRole(
  config: OpenKarenConfig,
  role: WorkforceRole,
  spend?: { remainingRatio: number | null },
): string | null {
  const persona = loadPersona(config, role);
  const tierName = persona ? chooseTier(persona, spend) : null;
  return stringValue(tierName ? persona?.tiers?.[tierName]?.model : null) ?? null;
}

function loadPersona(config: OpenKarenConfig, role: WorkforceRole): PersonaJson | null {
  const path = join(config.workforcePersonaDir, `${ROLE_PERSONA[role]}.json`);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as PersonaJson
      : null;
  } catch (error) {
    console.warn('OpenKaren could not load workforce persona', {
      role,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function chooseTier(persona: PersonaJson, spend?: { remainingRatio: number | null }): string | null {
  const tiers = persona.tiers;
  if (!tiers) {
    return null;
  }

  if (typeof spend?.remainingRatio === 'number') {
    if (spend.remainingRatio <= 0.25 && tiers.minimum) {
      return 'minimum';
    }

    if (spend.remainingRatio > 0.75 && tiers.best) {
      return 'best';
    }
  }

  if (tiers['best-value']) {
    return 'best-value';
  }

  if (tiers.best) {
    return 'best';
  }

  if (tiers.minimum) {
    return 'minimum';
  }

  return Object.keys(tiers)[0] ?? null;
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
