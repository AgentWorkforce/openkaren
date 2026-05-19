# OpenKaren v1 spec 05: durable state and Cloudflare production path

## Goal

Make the state story production-honest. Local memory fallback is useful for tests,
but v1 needs a clear, deployable, verified Durable Object path.

## Current state

- `workers/karen` defines a Cloudflare Worker and `KarenUserDO`.
- `src/state.ts` has an HTTP client and in-memory fallback.
- Worker typecheck exists.
- State schema includes sessions, messages, budget, workflow state, memory, and
  Nango connections.

## Desired behavior

### Worker API contract

Document and test the HTTP contract:

- sessions
- messages
- message search
- memory
- memory search
- Nango connection upsert/read
- workflow state
- due workflows
- budget check/record

### Deployment readiness

Add or verify:

- `wrangler.toml`
- migration tags
- auth token behavior
- local `wrangler dev` instructions
- production deploy instructions
- smoke test script

### Runtime behavior

When `OPENKAREN_STATE_WORKER_URL` is set:

- local runtime should use the Worker as authoritative state
- failures should be visible but not silently corrupt local behavior
- `/status` should say state is remote/DO-backed

## Acceptance criteria

- Worker typecheck passes.
- Worker API has a focused test suite.
- A smoke test can run against `wrangler dev`.
- `/status` and `/integrations` distinguish local fallback vs DO-backed state.
- State worker auth failures produce actionable errors.

## Validation

- Add `test:worker-api` or equivalent.
- Add `npm run worker:dev` and `npm run worker:deploy` scripts if appropriate.
- Manual: `wrangler dev workers/karen` plus smoke test.

