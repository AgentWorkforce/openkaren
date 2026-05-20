# Self-Hosted Guide

OpenKaren is designed to run locally first and can connect to hosted services when configured. Keep the local, cloud, and MCP routes explicit so release checks are repeatable.

## Local Route

- Run `karen start` on a trusted machine.
- Keep the dashboard bound to `127.0.0.1` or `localhost`.
- Store runtime state under `OPENKAREN_DATA_DIR`, defaulting to `.openkaren`.
- Run `karen doctor` after changing environment variables.

## Cloud Route

- Use Cloudflare Worker state only when hosted state is in scope.
- Set `OPENKAREN_STATE_WORKER_URL` and `OPENKAREN_STATE_AUTH_TOKEN` locally.
- Set `KAREN_STATE_TOKEN` on the Worker.
- Verify hosted state through the launch checklist's optional Cloudflare Worker smoke.

## MCP Route

- Use MCP servers for context and semantic code tools.
- Runtime workflow agents must not call Relaycast management or messaging tools.
- Keep generated workflow outputs on disk before deterministic gates run.

## Required Local Services

- Agent Relay for multi-agent execution.
- Relayfile for local shared file events when enabled.
- Relaycron for proactive schedules when enabled.
- Relaycast for webhook ingress when enabled.
- Nango for OAuth-backed integration state when enabled.
