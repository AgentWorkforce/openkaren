# OpenKaren v1 Release Notes Template

## Summary

- Release:
- Date:
- Operator:
- Checklist: `docs/release/v1-launch-checklist.md`

## Validation

- `npm run test:spec`:
- `npm run build`:
- `karen doctor`:
- `karen setup token-tools --check`:

## Manual Smoke

- Telegram `good morning Karen` did not start relay work:
- `/status`:
- `/integrations`:
- `/spend`:
- `/forecast`:
- Dashboard `http://127.0.0.1:7528/dashboard`:
- `/do make a harmless test-only change` relay or queue behavior:
- Burn dashboard OpenKaren scope:

## Optional Smokes

- Slack webhook smoke, optional when Slack is in scope:
- Cloudflare Worker smoke, optional when hosted state is in scope:

## Changes

- Added:
- Changed:
- Fixed:
- Security:
- Operational notes:

## Rollback

- Rollback doc reviewed: `docs/release/rollback.md`
- Previous version:
- Rollback owner:
- Data/state considerations:

## Residual Risk

- Skipped optional checks:
- Known external dependencies:
- Follow-up items:
