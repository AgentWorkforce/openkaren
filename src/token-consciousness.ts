import { spawn } from 'node:child_process';
import type { OpenKarenConfig, OpenKarenTurn } from './types.js';

const BURN_TIMEOUT_MS = 15_000;

export type SpendSnapshot = {
  available: boolean;
  source: 'burn' | 'unavailable';
  budgetUsd: number;
  spendUsd: number | null;
  remainingUsd: number | null;
  remainingRatio: number | null;
  detail: string;
};

export async function stampBurnSession(
  config: OpenKarenConfig,
  turn: OpenKarenTurn,
): Promise<void> {
  await runBurn(config, [
    'stamp',
    turn.message.sessionId ?? turn.message.id,
    '--persona',
    'karen',
    '--user-id',
    turn.message.userId,
    '--workflow-id',
    turn.message.id,
    '--tier',
    'hosted-$75',
  ]).catch(() => ({ ok: false as const, error: 'burn stamp failed' }));
}

export async function readSpendSnapshot(
  config: OpenKarenConfig,
  userId: string,
): Promise<SpendSnapshot> {
  void userId;
  const result = await runBurn(config, ['summary', '--json', '--since', monthStartIso()]);
  if (!result.ok) {
    return unavailableSnapshot(config, result.error);
  }

  const parsed = parseBurnSpend(result.stdout);
  if (parsed === null) {
    return unavailableSnapshot(config, 'burn did not return a recognizable spend payload');
  }

  const budgetUsd = parsed.budgetUsd ?? config.monthlyBudgetUsd;
  const spendUsd = parsed.spendUsd;
  const remainingUsd = Math.max(0, budgetUsd - spendUsd);

  return {
    available: true,
    source: 'burn',
    budgetUsd,
    spendUsd,
    remainingUsd,
    remainingRatio: budgetUsd > 0 ? remainingUsd / budgetUsd : 0,
    detail: 'burn monthly spend',
  };
}

export function spendText(snapshot: SpendSnapshot): string {
  if (!snapshot.available || snapshot.spendUsd === null || snapshot.remainingUsd === null) {
    return [
      `Spend: unavailable`,
      `Budget: ${formatUsd(snapshot.budgetUsd)} / month`,
      `Reason: ${snapshot.detail}`,
    ].join('\n');
  }

  return [
    `Spend: ${formatUsd(snapshot.spendUsd)} / ${formatUsd(snapshot.budgetUsd)}`,
    `Remaining: ${formatUsd(snapshot.remainingUsd)} (${formatPercent(snapshot.remainingRatio)})`,
    `Source: ${snapshot.source}`,
  ].join('\n');
}

export function forecastText(snapshot: SpendSnapshot, now = new Date()): string {
  if (!snapshot.available || snapshot.spendUsd === null || snapshot.remainingUsd === null) {
    return [
      'Forecast: unavailable',
      `Reason: ${snapshot.detail}`,
      `Budget: ${formatUsd(snapshot.budgetUsd)} / month`,
    ].join('\n');
  }

  if (snapshot.spendUsd <= 0) {
    return [
      'Forecast: no spend yet this month.',
      `Budget: ${formatUsd(snapshot.budgetUsd)} / month`,
    ].join('\n');
  }

  const dayOfMonth = Math.max(1, now.getDate());
  const dailyRate = snapshot.spendUsd / dayOfMonth;
  const daysUntilBudget = Math.floor(snapshot.remainingUsd / dailyRate);

  return [
    `Forecast: ${daysUntilBudget > 0 ? `budget reaches zero in about ${daysUntilBudget} days` : 'budget is exhausted'}.`,
    `Run rate: ${formatUsd(dailyRate)} / day`,
    `Spend: ${formatUsd(snapshot.spendUsd)} / ${formatUsd(snapshot.budgetUsd)}`,
  ].join('\n');
}

export function budgetGateText(snapshot: SpendSnapshot): string | null {
  if (!snapshot.available || snapshot.remainingUsd === null || snapshot.remainingRatio === null) {
    return null;
  }

  if (snapshot.remainingUsd <= 0 || snapshot.remainingRatio <= 0) {
    return [
      'Budget exhausted.',
      `${formatUsd(snapshot.spendUsd ?? snapshot.budgetUsd)} / ${formatUsd(snapshot.budgetUsd)} used.`,
      'I am not spawning a coding worker until budget is raised. Annoying, but cheaper than denial.',
    ].join('\n');
  }

  return null;
}

export function routingTierForBudget(snapshot: SpendSnapshot): 'premium' | 'standard' | 'economy' {
  if (!snapshot.available || snapshot.remainingRatio === null) {
    return 'standard';
  }
  if (snapshot.remainingRatio <= 0.25) return 'economy';
  if (snapshot.remainingRatio > 0.75) return 'premium';
  return 'standard';
}

// Backward-compatible alias for a typo that made it into an import path during development.
export const budgetGatText = budgetGateText;

function parseBurnSpend(stdout: string): { spendUsd: number; budgetUsd?: number } | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  const asNumber = Number.parseFloat(trimmed);
  if (Number.isFinite(asNumber)) {
    return { spendUsd: asNumber };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const spendUsd = firstNumber(parsed, [
    'spendUsd',
    'monthlySpendUsd',
    'monthlySpend',
    'totalUsd',
    'amountUsd',
    'amount',
  ]);
  const nestedSpendUsd = firstNumber(asRecord(parsed.totalCost), ['total']);
  if (spendUsd === null && nestedSpendUsd === null) {
    return null;
  }

  const budgetUsd = firstNumber(parsed, ['budgetUsd', 'monthlyBudgetUsd', 'budget']);
  const resolvedSpendUsd = spendUsd ?? nestedSpendUsd;
  if (resolvedSpendUsd === null) {
    return null;
  }

  return budgetUsd === null
    ? { spendUsd: resolvedSpendUsd }
    : { spendUsd: resolvedSpendUsd, budgetUsd };
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function runBurn(
  config: Pick<OpenKarenConfig, 'burnCommand'>,
  args: string[],
  stdin?: string,
): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn(config.burnCommand, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, error: `${config.burnCommand} timed out` });
    }, BURN_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: `${config.burnCommand} unavailable: ${error.message}` });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      if (exitCode === 0) {
        resolve({ ok: true, stdout });
        return;
      }
      resolve({
        ok: false,
        error: `${config.burnCommand} exited ${exitCode}: ${stderr.trim() || 'no stderr'}`,
      });
    });

    if (stdin) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

function unavailableSnapshot(config: OpenKarenConfig, detail: string): SpendSnapshot {
  return {
    available: false,
    source: 'unavailable',
    budgetUsd: config.monthlyBudgetUsd,
    spendUsd: null,
    remainingUsd: null,
    remainingRatio: null,
    detail,
  };
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return '$0.00';
  }
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
