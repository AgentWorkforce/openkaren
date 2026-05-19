# OpenKaren implementation run: cleaner agent-relay usage and real end-to-end testing

Use `specs/cleaner-agent-relay-usage-and-real-e2e-testing.md` as the product spec.

This file adds tighter implementation guardrails for Ricky.

## Goal

Implement a narrow, honest improvement of OpenKaren's relay-backed coding-turn path.

This is not a broad architecture rewrite.

## Hard boundaries

Primary edit surface:

- `src/agent-runner.ts`
- `src/assistant.ts`
- `src/types.ts`
- `tests/agent-runner.ts`
- `tests/telegram-e2e.ts`
- optionally one new focused relay evidence test under `tests/`
- `DEVELOPMENT.md` only if needed for relay-path docs

Do **not** treat runtime state files like `state/recent-activity/context` as implementation targets.

Do **not** broaden into unrelated answer-quality, token-tool, dashboard, or routing cleanup unless absolutely required for relay correctness.

Do **not** declare success from generated artifact prose alone.

## Required behavior

Focus on the real relay-backed coding path.

The implementation should make it easier to answer, in code and in logs:

- when Karen chose relay mode
- when a relay session started
- whether a broker was started fresh or reused
- when coding work began
- when coding work completed or failed
- what result was surfaced back to the user

Keep queue/command modes working, but treat relay mode as the primary path for this implementation.

## Real end-to-end proof requirement

This run must include a real local end-to-end proof path.

For this spec, "real" means:
- actual OpenKaren runtime started
- `OPENKAREN_AGENT_MODE=relay`
- actual Telegram-style inbound path exercised
- actual relay-backed coding turn executed or meaningfully attempted
- actual logs and user-visible result captured

A pure mock-only test is not sufficient proof.

## Evidence rules

If you create an evidence artifact, it must not depend on `.workflow-artifacts/` existing for repo tests to pass.

If you write an evidence file, use a stable repo-safe path only for the implementation run, and do not make ordinary test success depend on generated folders.

The result summary must explicitly include:
- exact commands run
- whether the relay path was truly exercised
- whether broker reuse or startup behavior was observed
- what still remains unproven

## Required validation

At minimum, the implementation must pass whichever of these remain relevant after the narrow relay cleanup:

- `npm run test:agent-runner`
- `npm run test:e2e:telegram`
- `npm run typecheck`

If an additional focused relay evidence command is added, include it in the final result summary.

## Quality bar

Do not stop at "tests passed" if the actual relay path was not meaningfully exercised.

The implementation is not done unless the result summary clearly distinguishes between:
- mock confidence
- real relay-path proof
- remaining unknowns

## Deliverable

Implement a narrow relay-path cleanup, keep the repo coherent, and return a concise result summary listing:

- files changed
- commands run
- what was proven through the real relay-backed path
- what remains unproven
- any blocker encountered
