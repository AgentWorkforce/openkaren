# OpenKaren v1 spec 01: installation, doctor, and token-tool setup

## Goal

Make first install and setup boring. A user should be able to install OpenKaren,
run one setup check, and understand exactly what is ready or missing.

## Current state

- OpenKaren has `karen start`.
- OpenKaren has `karen setup token-tools`.
- RTK is an external native binary and must not use the unrelated npm package named `rtk`.
- Tilth is packaged as an npm dependency and configured through `.mcp.json`.
- TokenSave is an external native binary and can be configured through `tokensave install/init/sync/doctor`.
- `/integrations` exposes some readiness information, but there is no single `doctor` command.

## Desired behavior

Add a top-level diagnostic command:

```sh
karen doctor
karen doctor --json
```

It should check:

- Node version
- package version
- Telegram env/config presence
- relay mode readiness
- Agent Relay availability
- Ricky SDK import
- Burn CLI + Burn SDK
- RTK correctness, specifically Rust Token Killer
- Tilth MCP config
- TokenSave availability/index/agent hook status
- dashboard port/path availability
- Cloudflare Worker config if state worker is set
- Slack config if Slack is enabled
- Nango config if Nango webhook/base URL is set

## Setup command behavior

`karen setup token-tools` should remain explicit and non-magical.

It should:

- install/configure RTK only when missing or wrong
- install/configure TokenSave only when missing
- never require Telegram config
- support `--check`
- support `--dry-run`
- support `--json`
- print commands it ran or would run

## Acceptance criteria

- `karen doctor` exits `0` when only optional integrations are missing.
- `karen doctor` exits non-zero only for required startup blockers.
- `karen doctor --json` returns stable machine-readable sections.
- `karen setup token-tools --check` is safe in CI and never mutates disk.
- RTK name collision is detected and explained.
- TokenSave missing state is actionable.

## Validation

- Add CLI tests for `doctor`, `doctor --json`, and setup check mode.
- Keep `npm run test:spec` green.
- Manually run `node dist/cli.js doctor` after `npm run build`.

