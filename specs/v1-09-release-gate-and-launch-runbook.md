# OpenKaren v1 spec 09: release gate and launch runbook

## Goal

Define the final v1 launch checklist and make release readiness repeatable.

## Release candidate requirements

Before tagging v1:

- `npm run test:spec`
- `npm run build`
- `karen doctor`
- `karen setup token-tools --check`
- manual Telegram smoke test
- manual dashboard smoke test
- manual `/spend` and `/forecast` check
- optional Slack webhook smoke test if Slack is in scope for launch
- optional Cloudflare Worker smoke test if hosted state is in scope for launch

## Manual smoke script

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

## Launch docs

Create or update:

- installation guide
- self-hosted guide
- token tools guide
- Telegram setup guide
- Slack setup guide
- Cloudflare state guide
- troubleshooting guide

## Versioning

Define:

- package version bump process
- changelog format
- release notes template
- rollback instructions

## Acceptance criteria

- A single launch checklist exists and is linked from development docs.
- v1 release notes can be generated from the checklist.
- The user can reproduce the launch smoke test without reading source code.

## Validation

- Docs review.
- One full local launch rehearsal.

