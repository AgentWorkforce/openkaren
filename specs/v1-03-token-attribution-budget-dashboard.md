# OpenKaren v1 spec 03: token attribution, budget, and dashboard

## Goal

Make OpenKaren's token consciousness true and user-trustworthy.

The dashboard and `/spend` must show OpenKaren usage, not all Codex or all Burn
ledger usage. The user should be able to see what Karen cost, how many tokens it
used, and whether the monthly budget is still safe.

## Current state

- OpenKaren uses Burn.
- Burn dashboard currently reads through OpenKaren code paths.
- OpenKaren tags future turns with:
  - `app=openkaren`
  - `persona=karen`
  - `tenant=<OPENKAREN_STATE_USER_ID>`
- The dashboard displays spend, remaining budget, token count, forecast, and
  tool status.

## Desired behavior

### Burn attribution

Every OpenKaren coding turn should write a pending Burn stamp before spawning
workers.

Required tags:

- `app=openkaren`
- `persona=karen`
- `tenant=<OPENKAREN_STATE_USER_ID>`
- `surface=<telegram|slack|relaycast>`
- `surfaceUserId=<user id>`
- `workflowId=openkaren-turn`
- `workflowRunId=<message id>`
- `tier=hosted-$75`

OpenKaren should ingest after the turn completes so the dashboard updates without
requiring a separate watch process.

### Dashboard

Dashboard should show:

- scoped spend
- scoped token count
- budget limit
- remaining dollars
- forecast
- source and tag scope
- token tool readiness
- refresh timestamp

It should also expose JSON at `/dashboard/data`.

### Telegram spend commands

`/spend` and `/forecast` should use the same scoped data as the dashboard.

## Acceptance criteria

- Dashboard does not show global Codex spend.
- `/spend` and `/dashboard/data` agree.
- If Burn is unavailable, dashboard reports unavailable rather than stale or
  global values.
- If no OpenKaren spend exists, dashboard shows zero OpenKaren spend.
- Budget gating uses OpenKaren-scoped spend.

## Validation

- Unit tests for Burn summary args/tags.
- Dashboard webhook tests for HTML and JSON.
- Manual check: run a Karen turn, refresh dashboard, confirm timestamp and
  scoped spend/token count update after Burn ingest.

