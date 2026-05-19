# OpenKaren v1 spec 06: relay execution reliability and evidence

## Goal

Make relay-backed work feel reliable, inspectable, and provable.

OpenKaren should not merely claim it uses agent-relay. v1 should include evidence
that real work traverses the relay path end to end.

## Current state

- Relay mode is default.
- Orchestrated planner/implementer/reviewer/verifier workflow exists.
- Broker reuse behavior exists.
- Tests cover mocked relay flow.
- Existing specs cover cleaner relay usage and real E2E testing.

## Desired behavior

### Execution evidence

Add a launch-grade evidence artifact for relay turns:

- message id
- session key
- workflow mode
- roles spawned
- models/personas selected
- broker reused vs fresh
- started/completed timestamps
- wait status
- final summary

This can be stored under `.openkaren/runs` or durable state.

### User-facing lifecycle

User-facing text should distinguish:

- accepted
- dispatched through relay
- still working
- completed
- timed out
- failed to start
- failed during execution

### Real-path validation

Add a manual or gated test that can run a real relay execution against a trivial
repo task without relying only on mocks.

## Acceptance criteria

- `/status` can report the active relay turn and last relay run.
- Relay result includes enough metadata for debugging.
- Broker reuse is logged and test-covered.
- A real-path test command exists, even if skipped unless env is set.

## Validation

- Existing mocked relay tests remain.
- New evidence tests assert run artifact shape.
- Optional live test: `OPENKAREN_LIVE_RELAY_TEST=1 npm run test:relay-live`.

