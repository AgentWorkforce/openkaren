OpenKaren
==================

That's right. We're taking the name back.
Part of the Openclaw, Hermes, NangoClaw generation.

# Karen is cheap
Token conscious by default, saves you money

# Karen is proactive
Takes initiative, and is in your face

# Kaern is multi agent
Ropes in everyone around her

# Karen is _everywhere_
Telegram, Slack, Whatsapp, Discord.

# Ready to get started?
```
npm install -g openkaren

karen start
```

## Release

The v1 launch gate is documented in [docs/release/v1-launch-checklist.md](docs/release/v1-launch-checklist.md). Use it for release candidate checks, launch smoke tests, release notes, and rollback readiness before tagging v1.

## Self Hosted
Karen under the hood is a lot of different components working together:
- Agent Relay
- Relayfile
- Relaycron
- Relaycast
- Nango

If you want to self host you need to setup each of those and have them running. See [Self Hosted](docs/self-hosted.md) for more info

## Hosted
- Run on your mac mini or web

## Data Locations

OpenKaren stores operational state in these places:

- `.openkaren`: local runtime data, queued work, relay evidence, and OpenKaren-owned state files under `OPENKAREN_DATA_DIR`.
- Burn ledger: token spend data in the Burn/RelayBurn ledger selected by the installed `burn` CLI and SDK.
- TokenSave index: semantic code index under `.tokensave` when TokenSave is installed and synced.
- Relay state: Agent Relay broker/session state under `.openkaren/relay-state` unless the relay SDK is configured otherwise.
- Cloudflare Durable Objects: production state records in the `KarenUserDO` Durable Object behind `OPENKAREN_STATE_WORKER_URL`.
- relayfile mount: local shared files under `OPENKAREN_RELAYFILE_MOUNT_DIR`, defaulting to `relayfile-mount`.

## Production Mode

Use real accounts only with explicit access boundaries:

- Set `TELEGRAM_ALLOWED_CHAT_IDS` to trusted chat ids. `karen doctor` warns when it is empty.
- Set `OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS` when Slack is enabled. Empty means every signed Slack channel is accepted.
- Set `OPENKAREN_STATE_AUTH_TOKEN` locally and `KAREN_STATE_TOKEN` on the Cloudflare Worker. Deployed state workers reject requests without a bearer token.
- Keep the dashboard bound to `127.0.0.1` or `localhost`. Disable it with `OPENKAREN_DASHBOARD=off` or `OPENKAREN_DASHBOARD_ENABLED=false`.
- Keep secrets out of prompts, logs, and dashboard data. User-visible doctor/setup errors and dashboard JSON pass through the shared redaction helper.

Operational behavior:

- `SIGINT` and `SIGTERM` trigger graceful shutdown of Telegram polling, RelayCron schedules, Relayfile watching, and the webhook/dashboard listener.
- `/status` and the dashboard active-turn panel show the current coding turn state when one is in flight.
- Agent turns use `OPENKAREN_AGENT_TIMEOUT_MS`; relay progress updates use `OPENKAREN_AGENT_RELAY_PROGRESS_INTERVAL_MS`.
- Relay and state writes retry through their existing SDK/client paths; when the State Worker is unreachable, OpenKaren falls back to local in-memory state and emits a warning.
