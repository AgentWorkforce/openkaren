# OpenKaren v1 launch stream

## Goal

Turn the current OpenKaren implementation into a coherent v1 launch candidate.

This is a stream of implementation specs, ordered so each one leaves the product
more shippable without requiring a giant rewrite. Each spec should be small
enough to execute as a focused PR and concrete enough to validate with tests or a
manual launch check.

## v1 launch definition

OpenKaren v1 is ready when a user can:

1. install OpenKaren
2. run setup/doctor
3. connect Telegram
4. optionally connect Slack and webhooks
5. send casual chat without spawning workers
6. send actionable work and see relay-backed execution
7. inspect token spend that is scoped to OpenKaren, not global Codex usage
8. open a local dashboard
9. rely on durable state in production-like mode
10. understand what is configured, missing, and safe to launch

## Stream order

Run these specs in order:

1. `v1-01-installation-doctor-and-token-tool-setup.md`
2. `v1-02-first-run-onboarding-and-command-surface.md`
3. `v1-03-token-attribution-budget-dashboard.md`
4. `v1-04-telegram-slack-session-bridging.md`
5. `v1-05-durable-state-cloudflare-production-path.md`
6. `v1-06-relay-execution-reliability-and-evidence.md`
7. `v1-07-integrations-and-automation-mesh.md`
8. `v1-08-security-privacy-and-operability.md`
9. `v1-09-release-gate-and-launch-runbook.md`

## Non-negotiable launch gates

- `npm run test:spec` passes.
- `npm run build` passes.
- `karen setup token-tools --check` gives actionable output without requiring Telegram config.
- `/status`, `/integrations`, `/spend`, `/forecast`, and `/dashboard` agree about configured runtime state.
- A greeting such as "good morning Karen" never starts relay work.
- A concrete coding task does start the configured execution path.
- Burn spend is scoped by OpenKaren tags.
- The dashboard does not present global Codex spend as Karen spend.
- Missing optional integrations are reported as missing/configured, not silently assumed wired.

## Product stance

OpenKaren v1 should be honest. If a dependency is not installed, not configured,
or only partially integrated, Karen should say that directly. The product can be
sharp and funny, but it should not bluff about operational readiness.

