# Cloudflare State Guide

Cloudflare Worker state is optional for v1 and should only be smoke-tested when hosted state is in launch scope.

## Worker

- Worker source lives under `workers/karen`.
- Production state records are stored by `KarenUserDO`.
- Set `KAREN_STATE_TOKEN` in the Worker environment.

## Local Client

- Set `OPENKAREN_STATE_WORKER_URL` to the Worker URL.
- Set `OPENKAREN_STATE_AUTH_TOKEN` locally.
- Keep `OPENKAREN_STATE_USER_ID` stable for the operator.

## Smoke Test

1. Deploy the Worker.
2. Start Karen locally with the Worker URL and auth token.
3. Run `karen doctor`.
4. Confirm state-backed sessions, budget checks, and active relay turn state work.

Record the smoke as skipped when hosted state is out of scope for the launch.
