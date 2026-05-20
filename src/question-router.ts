import { spawn } from 'node:child_process';
import type {
  OpenKarenConfig,
  QuestionRouterContextPacket,
  QuestionRouterDecision,
  QuestionRouterIntent,
  QuestionRouterRoute,
} from './types.js';

type RouterEnv = Pick<OpenKarenConfig, 'questionRouterModel' | 'questionRouterCli' | 'agentCwd'>;

type RouterHarnessRunner = (prompt: string, env: RouterEnv) => Promise<string | null>;

const ROUTES = new Set<QuestionRouterRoute>(['direct_answer', 'clarify', 'coding_task']);
const INTENTS = new Set<QuestionRouterIntent>([
  'architecture',
  'integration_status',
  'integration_assessment',
  'improvement_advice',
  'runtime_status',
  'recent_activity',
  'capabilities',
  'skills_tools',
  'model_setup',
  'general',
]);

let routerHarnessRunner: RouterHarnessRunner = runRouterHarnessPrompt;

export async function decideQuestionRoute(
  message: string,
  context: QuestionRouterContextPacket,
  env: RouterEnv,
): Promise<QuestionRouterDecision | null> {
  if (!env.questionRouterModel) {
    return null;
  }

  const prompt = [
    'You are a lightweight routing layer for OpenKaren.',
    'Route normal non-command chat messages without launching coding work unless the user asks for concrete development action.',
    'Use coding_task only for requests to fix, inspect, implement, review, update, run, spawn an agent, delegate investigation, or otherwise change work.',
    'Use direct_answer for questions about architecture, integration status, integration depth, improvement advice, runtime status, recent activity, capabilities, skills/tools, or model setup.',
    'Use clarify only when the message is too vague to answer from the provided local context.',
    'Return JSON only: {"route":"direct_answer"|"clarify"|"coding_task","intent":"architecture"|"integration_status"|"integration_assessment"|"improvement_advice"|"runtime_status"|"recent_activity"|"capabilities"|"skills_tools"|"model_setup"|"general","reason":"short optional reason"}.',
    'For direct_answer, intent is required. For clarify and coding_task, omit intent unless it is useful.',
    '',
    JSON.stringify({
      message,
      context: {
        activeWork: context.activeWork,
        wiredIntegrations: context.wiredIntegrations,
        recentMessages: context.recentMessages.slice(0, 4),
        pendingWorkflows: context.pendingWorkflows.slice(0, 4),
        repoSummary: context.repoSummary,
        modeSummary: context.modeSummary,
        skillSummary: context.skillSummary,
        integrationSummary: context.integrationSummary,
      },
    }),
  ].join('\n');

  const output = await routerHarnessRunner(prompt, env);
  return parseQuestionRouterDecision(output);
}

async function runRouterHarnessPrompt(prompt: string, env: RouterEnv): Promise<string | null> {
  const cli = env.questionRouterCli ?? 'codex';
  if (cli !== 'codex') {
    return null;
  }

  return await new Promise((resolve) => {
    const child = spawn(cli, ['exec', '--skip-git-repo-check', '--model', env.questionRouterModel as string, prompt], {
      cwd: env.agentCwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      resolve((stdout || stderr).trim() || null);
    });
  });
}

export function setQuestionRouterHarnessRunnerForTesting(runner: RouterHarnessRunner | null): void {
  routerHarnessRunner = runner ?? runRouterHarnessPrompt;
}

export function parseQuestionRouterDecision(text: string | null): QuestionRouterDecision | null {
  if (!text) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.route !== 'string' || !ROUTES.has(record.route as QuestionRouterRoute)) {
    return null;
  }

  const route = record.route as QuestionRouterRoute;
  const intent = typeof record.intent === 'string' && INTENTS.has(record.intent as QuestionRouterIntent)
    ? record.intent as QuestionRouterIntent
    : undefined;

  if (route === 'direct_answer' && !intent) {
    return null;
  }

  return {
    route,
    ...(intent ? { intent } : {}),
    ...(typeof record.reason === 'string' && record.reason.trim()
      ? { reason: record.reason.trim().slice(0, 240) }
      : {}),
  };
}

