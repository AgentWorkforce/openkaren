import { parseQuestionRouterDecision } from '../src/question-router.js';

assertDecision(
  parseQuestionRouterDecision('{"route":"direct_answer","intent":"architecture","reason":"architecture question"}'),
  { route: 'direct_answer', intent: 'architecture', reason: 'architecture question' },
  'direct answer decision',
);

assertDecision(
  parseQuestionRouterDecision('{"route":"clarify","reason":"too vague"}'),
  { route: 'clarify', reason: 'too vague' },
  'clarify decision',
);

assertDecision(
  parseQuestionRouterDecision('{"route":"coding_task","reason":"asks to fix code"}'),
  { route: 'coding_task', reason: 'asks to fix code' },
  'coding task decision',
);

assertEqual(
  parseQuestionRouterDecision('{"route":"direct_answer"}'),
  null,
  'direct answer without intent is rejected',
);

assertEqual(
  parseQuestionRouterDecision('{"route":"chat","intent":"what model"}'),
  null,
  'non-contract route is rejected',
);

assertEqual(
  parseQuestionRouterDecision('not json'),
  null,
  'invalid JSON is rejected',
);

console.log('question router parser ok');

function assertDecision<T>(actual: T, expected: T, label: string): void {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${label} ${String(expected)}, got ${String(actual)}`);
  }
}
