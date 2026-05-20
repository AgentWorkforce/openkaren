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

## Approval boundary

This spec may modify only local repository files and local test/dev scripts.

Allowed without further approval:
- edit source, tests, docs, config examples, package scripts, and Wrangler config inside this repo
- add local-only smoke-test helpers that run against `wrangler dev` or in-process test harnesses
- run local typecheck/tests and local `wrangler dev` smoke checks against a developer-provided token

Not allowed without explicit user approval:
- deploy to a real Cloudflare account
- create, modify, or delete remote Cloudflare resources
- rotate or mint production tokens/secrets
- send writes to real user data stores outside local/dev fixtures

If a realistic proof requires a remote Cloudflare account, stop at a documented local/dev rehearsal and mark the remaining step `DEFERRED-TO-OPERATOR`.

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
- production deploy instructions marked as operator-run only
- smoke test script for local/dev only

### Runtime behavior

When `OPENKAREN_STATE_WORKER_URL` is set:

- local runtime should use the Worker as authoritative state
- failures should be visible but not silently corrupt local behavior
- `/status` should say state is remote/DO-backed

## Acceptance criteria

- Worker typecheck passes.
- Worker API has a focused local test suite.
- A smoke test can run against `wrangler dev` or a local equivalent harness without touching a real Cloudflare account.
- `/status` and `/integrations` distinguish local fallback vs DO-backed state.
- State worker auth failures produce actionable errors.
- The spec output clearly separates `agent-executed` local validation from any `DEFERRED-TO-OPERATOR` remote deploy/rehearsal steps.

## Validation

- Add `test:worker-api` or equivalent.
- Add `npm run worker:dev` if appropriate.
- Add `npm run worker:deploy` only as an operator-facing wrapper, not something the workflow should execute automatically.
- Manual/local: `wrangler dev workers/karen` plus smoke test, or an equivalent fully local harness when `wrangler` is unavailable.

## Evidence contract

The resulting workflow must provide deterministic local evidence for the failed-path and success-path cases:

- unauthorized request returns an actionable auth error
- authorized request reaches the Worker API contract successfully
- `/status` or related runtime status text distinguishes remote Worker-backed state from local fallback
- if remote deployment is not executed, the result must say so explicitly and label it `DEFERRED-TO-OPERATOR`

Do not count a planned production deploy, a prose-only claim, or a generated artifact placeholder as successful evidence.

