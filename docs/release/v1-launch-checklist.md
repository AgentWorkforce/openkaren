# OpenKaren v1 Launch Checklist

Use this checklist for every v1 release candidate before creating the tag. Materialize command output and smoke-test notes to disk for the release record, then stop for deterministic gates before publishing.

## Routing Contract

- Local callers run the launch gate through Agent Relay using the generated workflow artifact.
- Cloud callers receive the same generated artifact contract unless a later spec defines a separate cloud path.
- MCP runtime agents must not use Relaycast management or messaging tools; MCP routes are only configuration and context inputs for the generated runtime.

## Release Candidate Requirements

- [ ] Run `npm run test:spec`.
- [ ] Run `npm run build`.
- [ ] Run `karen doctor`.
- [ ] Run `karen setup token-tools --check`.
- [ ] Complete the manual Telegram smoke test below.
- [ ] Complete the manual dashboard smoke test below.
- [ ] Run manual `/spend` and `/forecast` checks.
- [ ] Optional, only if Slack is in scope for this launch: run the Slack webhook smoke test.
- [ ] Optional, only if hosted state is in scope for this launch: run the Cloudflare Worker smoke test.

## Manual Smoke Script

1. Start Karen locally.
2. Open Telegram and send `good morning Karen`.
3. Confirm no relay work starts.
4. Send `/status`.
5. Send `/integrations`.
6. Send `/spend`.
7. Open `http://127.0.0.1:7528/dashboard`.
8. Send `/do make a harmless test-only change` in a throwaway repo or fixture.
9. Confirm relay/queue behavior matches configured mode.
10. Confirm Burn dashboard remains OpenKaren-scoped.

## Manual Dashboard Smoke

- Open `http://127.0.0.1:7528/dashboard` after `karen start`.
- Confirm spend, forecast, token tools, and active relay state render without exposing secrets.
- Confirm the Burn dashboard data is scoped to OpenKaren and does not include unrelated app or persona spend.

## Manual Spend And Forecast Smoke

- Send `/spend` from an allowed Telegram chat.
- Send `/forecast` from the same chat.
- Confirm both commands return a budget-aware OpenKaren-scoped answer.

## Optional Slack Webhook Smoke

Run this only when Slack is part of the launch scope.

- Set `OPENKAREN_SLACK_ENABLED=true`, `SLACK_BOT_TOKEN`, `OPENKAREN_SLACK_SIGNING_SECRET`, and `OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS`.
- Start Karen locally and POST a signed Slack event to the configured Slack webhook path.
- Confirm the response is accepted and any follow-up stays in the original Slack thread.

## Optional Cloudflare Worker Smoke

Run this only when hosted state is part of the launch scope.

- Deploy the `workers/karen` Worker with `KAREN_STATE_TOKEN` configured.
- Set local `OPENKAREN_STATE_WORKER_URL` and `OPENKAREN_STATE_AUTH_TOKEN`.
- Run `karen doctor` and confirm the Cloudflare Worker state check passes or only reports expected optional warnings.

## Release Notes Inputs

The v1 release notes are generated from this checklist:

- Commands run map to the validation section.
- Manual smoke script results map to the launch rehearsal section.
- Optional Slack and Cloudflare results map to scoped integration notes.
- Known skipped optional checks map to the residual risk section.
