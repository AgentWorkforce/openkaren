# OpenKaren implementation run: answer quality, advisory behavior, and integration-depth responses

Use `specs/answer-quality-and-advisory-behavior.md` as the product spec.

This file adds tighter implementation guardrails for Ricky.

## Goal

Implement the answer-quality spec in a way that improves real OpenKaren replies without introducing artifact-coupled tests, fake evidence, or unstable runtime behavior.

## Hard boundaries

Only edit the following implementation surface unless a tiny adjacent helper is truly necessary:

- `src/assistant.ts`
- `src/question-router.ts`
- `src/types.ts`
- `tests/direct-chat-answers.ts`
- `tests/question-router.ts`
- `tests/question-router.test.ts`
- `tests/telegram-greeting.ts`
- optionally one new focused test file under `tests/` if needed

Do **not** treat runtime state files like `state/recent-activity/context` as edit targets.

Do **not** write test outputs or evidence into `.workflow-artifacts/`, `workflows/`, or any generated-run directory.

Do **not** add a test that only passes because a generated artifact directory exists.

Do **not** introduce a brittle coupling where a repo test writes into a Ricky-generated folder.

## Required behavior

You must solve these specific issues:

1. Karen should answer integration-depth questions with judgment-first prose.
2. Karen should answer improvement/advice questions with concrete recommendations.
3. Relay-specific questions must get relay-specific answers.
   - Example: "How real is the relay integration?" must not return an `agent-assistant`-focused answer.
4. General fallback should remain available, but not hijack questions that clearly ask for assessment or advice.
5. Greeting/small-talk behavior must remain intact.

## Testing rules

Tests must be runnable directly from the repo without Ricky-generated directories.

Allowed validation style:
- `node --import tsx tests/...`
- existing repo test style
- `npm run typecheck`

Avoid adding a hard dependency on Vitest unless the repo already installs and uses it directly for the new test path.

If you add end-to-end evidence capture, it must:
- live in a normal repo test file under `tests/`
- write to a stable temp or repo-safe path only if truly necessary
- assert reply quality deterministically
- fail when the reply is off-target or fallback-shaped

## Required validation

At minimum, the implementation must pass:

- `node --import tsx tests/question-router.test.ts`
- `npm run test:direct-chat-answers`
- `npm run test:telegram-greeting`
- `npm run typecheck`

If you add another focused evidence test, include the exact command in the result summary.

## Quality bar

Do not stop at a passing generic answer.

The implementation is not done unless all of these are true:

- relay questions receive relay-focused answers
- advice questions return ranked or clearly ordered improvements
- integration assessment answers sound like product judgment, not system dump
- tests remain repo-native and stable after generated artifacts are deleted

## Deliverable

Implement the answer-quality behavior cleanly in source/tests, keep the repo coherent, and return a concise result summary listing:

- files changed
- commands run
- whether relay-specific assessment was fixed
- any remaining weakness
