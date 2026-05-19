import type {
  OpenKarenConfig,
  QuestionRouterContextPacket,
  QuestionRouterDecision,
  QuestionRouterIntent,
  QuestionRouterRoute,
} from './types.js';

type RouterEnv = Pick<OpenKarenConfig, 'openaiApiKey' | 'questionRouterModel'>;

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

export async function decideQuestionRoute(
  message: string,
  context: QuestionRouterContextPacket,
  env: RouterEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<QuestionRouterDecision | null> {
  if (!env.openaiApiKey || !env.questionRouterModel) {
    return null;
  }

  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.openaiApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.questionRouterModel,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'You are a lightweight routing layer for OpenKaren.',
                'Route normal non-command chat messages without launching coding work unless the user asks for concrete development action.',
                'Use coding_task only for requests to fix, inspect, implement, review, update, run, or otherwise change work.',
                'Use direct_answer for questions about architecture, integration status, integration depth, improvement advice, runtime status, recent activity, capabilities, skills/tools, or model setup.',
                'Use clarify only when the message is too vague to answer from the provided local context.',
                'Return JSON only: {"route":"direct_answer"|"clarify"|"coding_task","intent":"architecture"|"integration_status"|"integration_assessment"|"improvement_advice"|"runtime_status"|"recent_activity"|"capabilities"|"skills_tools"|"model_setup"|"general","reason":"short optional reason"}.',
                'For direct_answer, intent is required. For clarify and coding_task, omit intent unless it is useful.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
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
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as unknown;
  return parseQuestionRouterDecision(extractOutputText(payload));
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

function extractOutputText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') {
    return record.output_text;
  }

  const output = record.output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const entry of content) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const text = (entry as Record<string, unknown>).text;
      if (typeof text === 'string') {
        return text;
      }
    }
  }

  return null;
}
