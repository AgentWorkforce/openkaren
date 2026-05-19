OpenKaren Development
=====================

The top-level `README.md` is human-generated product copy. Do not edit it from
agent work unless a human explicitly asks for that file.

## Telegram-first development

OpenKaren's first usable surface is Telegram. The runtime is built on
`@agent-assistant/sdk` for assistant identity, sessions, surfaces, and lifecycle,
with Telegram registered as the first surface adapter.

Create a bot with BotFather, then run:

```
cp .env.example .env
npm install
npm run build
TELEGRAM_BOT_TOKEN=123456:replace-me npm start
```

For active development, run the autoreloading process instead:

```
TELEGRAM_BOT_TOKEN=123456:replace-me npm run dev
```

`npm run dev` uses `tsx watch` and restarts OpenKaren when the CLI entrypoint or
its imported source files change. It ignores `.openkaren` and `dist` so queued
Telegram turns and build output do not cause restart loops.

Useful environment variables:

- `TELEGRAM_BOT_TOKEN`: required Telegram bot token
- `TELEGRAM_ALLOWED_CHAT_IDS`: optional comma-separated allowlist
- `OPENKAREN_AGENT_COMMAND`: optional local command that receives each Telegram
  development request on stdin
- `OPENKAREN_AGENT_CWD`: working directory for that command
- `OPENKAREN_AGENT_TIMEOUT_MS`: command timeout, default 15 minutes
- `OPENKAREN_AGENT_MODE`: `relay` by default, or `command`/`queue` for explicit fallback paths
- `OPENKAREN_AGENT_RELAY_CLI`: CLI spawned by relay, default `codex`
- `OPENKAREN_AGENT_RELAY_MODEL`: optional model override for spawned relay agents
- `OPENKAREN_AGENT_RELAY_CHANNEL`: relay coordination channel, default `openkaren-dev`
- `OPENKAREN_AGENT_RELAY_WORKFLOW`: `orchestrated` by default, or `single`
- `OPENKAREN_AGENT_RELAY_NAME_PREFIX`: spawned agent name prefix, default `OpenKarenCoder`
- `OPENKAREN_AGENT_RELAY_IDLE_THRESHOLD_SECONDS`: idle detection threshold, default 20 seconds
- `OPENKAREN_RELAYCAST_ENABLED`: start the Relaycast webhook surface
- `OPENKAREN_RELAYFILE_MOUNT_DIR`: mounted integration filesystem path
- `OPENKAREN_RELAYCRON_BASE_URL`: scheduler service URL
- `OPENKAREN_RELAYCRON_API_KEY`: scheduler API key
- `OPENKAREN_RELAYCRON_WEBHOOK_URL`: public or tunneled RelayCron callback URL
- `OPENKAREN_DASHBOARD_ENABLED`: serve the local token dashboard, default true
- `OPENKAREN_DASHBOARD_PATH`: dashboard route on the local HTTP listener, default `/dashboard`
- `OPENKAREN_STATE_WORKER_URL`: Cloudflare Worker proxy for KarenUserDO durable state
- `OPENKAREN_STATE_AUTH_TOKEN`: bearer token for the state Worker
- `OPENKAREN_STATE_USER_ID`: per-user Durable Object routing key, default `local`
- `OPENKAREN_SLACK_ENABLED`: enable Slack webhook surface
- `OPENKAREN_SLACK_SIGNING_SECRET`: Slack request signing secret
- `OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS`: optional comma-separated Slack allowlist
- `OPENKAREN_SLACK_BOT_TOKEN`: local bot token resolved from Nango for development
- `OPENKAREN_WORKFORCE_PERSONA_DIR`: Workforce persona directory
- `OPENKAREN_RTK_COMMAND`, `OPENKAREN_TILTH_COMMAND`, `OPENKAREN_BURN_COMMAND`, `OPENKAREN_WASH_COMMAND`, `OPENKAREN_TOKENSAVE_COMMAND`: token/context tools used by coding prompts when installed. `OPENKAREN_RTK_COMMAND` must point at Rust Token Killer from `rtk-ai/rtk`; the unrelated npm package named `rtk` is detected as misconfigured.

By default, actionable non-command Telegram messages become development turns.
Low-intent chat such as `hey` stays in the lightweight chat path and does not
spawn relay work. OpenKaren delegates development turns through `agent-relay`,
which treats relay as the primary serious execution path: it acquires or reuses
a broker, spawns the configured CLI in `OPENKAREN_AGENT_CWD`, waits for the
worker to go idle, captures bounded logs, and sends the result back to Telegram.
Set `OPENKAREN_AGENT_MODE=queue` only when you want Telegram ingestion and local
inbox files in `.openkaren/inbox`.

The intended relay lifecycle is:

1. request accepted
2. coding turn classified
3. relay session acquired or existing broker reused
4. worker or workflow roles started
5. relay waits for idle/completion
6. result is summarized back to the user
7. turn cleanup finishes

`relay` is the preferred path, while `command` and `queue` remain explicit
fallback modes.

Example command wiring without relay:

```
OPENKAREN_AGENT_MODE=command
OPENKAREN_AGENT_COMMAND="codex exec --cd /Users/khaliqgant/Projects/AgentWorkforce/openkaren"
npm start
```

Telegram commands:

- `/start` or `/help`: show the active OpenKaren mode
- `/status`: show the active runtime and execution configuration
- `/integrations`: show Design dependency wiring status
- `/spend`: show monthly spend from Burn
- `/forecast`: forecast budget exhaustion from the current Burn run rate

The local token dashboard is served by the same HTTP listener used for webhooks.
With defaults, open `http://127.0.0.1:7528/dashboard` while Karen is running.
`/dashboard/data` returns the same spend payload as JSON.
Spend is scoped to Burn enrichment tags `app=openkaren`, `persona=karen`, and
`tenant=<OPENKAREN_STATE_USER_ID>`, so it does not report global Codex spend.

All other actionable Telegram messages are development turns. OpenKaren should
delegate them to the configured execution layer instead of falling back to a
separate chat/main-loop path.

## Dependency Wiring

OpenKaren keeps a runtime integration registry for every dependency named in
`Design.md`:

- `agent-assistant`: runtime shell, traits, sessions, surfaces
- `agent-relay`: coding-agent execution
- `relayfile`: mounted integration filesystem
- `relaycast`: webhook/channel surface
- `relaycron`: proactive scheduler configuration
- `ricky`: workflow generation and execution SDK dependency
- `workforce`: persona directory/profile context
- `nango`: OAuth provider backing for Relayfile stacks
- `inbox`, `n8n`, `pipedream`, `composio`: external automation ingress
- `rtk`, `tilth`, `burn`, `wash`, `tokensave`: token/context tools surfaced to workers

The registry powers `/integrations`, is included in `/status`, and is injected
into coding-agent prompts so workers know what is wired, configured, available,
or missing.

OpenKaren uses Ricky through the `@agentworkforce/ricky` package export, not by
spawning the `ricky` CLI. Code that needs workflow generation or execution should
create the local adapter with `createOpenKarenRicky(config)` from `src/ricky.ts`,
which wraps `createRickySdk({ cwd: config.agentCwd })`.

Authoritative state belongs in KarenUserDO. `src/state.ts` contains the Mac mini
client surface and an in-memory development fallback; `workers/karen` contains
the deployable Cloudflare Worker + Durable Object schema for sessions, messages,
budget, workflow state, memory, and Nango connections. The local fallback exists
so tests and first-run development do not require Cloudflare credentials, but
hosted or production-like runs should set `OPENKAREN_STATE_WORKER_URL`.

Slack is a first-class surface alongside Telegram. Local Mac mini mode receives
Slack events through `/webhooks/slack` on the existing webhook listener, usually
behind Cloudflare Tunnel. Slack and Telegram messages use `bridge:user:<id>`
session ids so the session bridge can join the same user across surfaces.

The n8n automation mesh is represented by `src/automation-mesh.ts`: relaycast
findings are routed by glob patterns to n8n webhooks, while n8n/Pipedream/
Composio events enter through `/webhooks/inbox`. Nango token refresh events POST
to `/webhooks/nango` and update the KarenUserDO Nango connection table.

When `OPENKAREN_RELAYCRON_BASE_URL`, `OPENKAREN_RELAYCRON_API_KEY`, and
`OPENKAREN_RELAYCRON_WEBHOOK_URL` are configured, relay coding turns register a
RelayCron schedule with `*/2 * * * *` and cancel it when the turn finishes. The
local in-process progress timer remains the fallback for development machines
without RelayCron.

The same RelayCron webhook path accepts proactive ticks. At startup, OpenKaren
registers `daily-standup`, `weekly-spend-review`, and `workflow-health-check`
when RelayCron is configured and exactly one Telegram chat is allowlisted.

Relayfile is watched when `OPENKAREN_RELAYFILE_MOUNT_DIR` exists. Changes under
the mounted integration filesystem are surfaced to the primary Telegram chat.

External automation ingress is available at `/webhooks/inbox` on the local
webhook listener. n8n, Pipedream, Composio, and Nango-style events can POST JSON
with `source` and `text`/`title`/`summary`.

Relay workers resolve Workforce personas from `OPENKAREN_WORKFORCE_PERSONA_DIR`.
Planner, implementer, reviewer, and verifier roles receive persona context and
use persona model tiers unless `OPENKAREN_AGENT_RELAY_MODEL` overrides them.
Burn spend snapshots downgrade persona tier selection near budget limits.

Token tools are wired in three places:

- `.mcp.json` starts Tilth as a local MCP server and TokenSave through `tokensave serve` when TokenSave is installed.
- `AGENTS.md` gives spawned Codex workers the project-level policy for RTK, Tilth, and TokenSave.
- OpenKaren validates token-tool commands in `/integrations` and injects exact RTK/Tilth/TokenSave guidance into relay and command prompts.
- `karen setup token-tools` installs/configures RTK and TokenSave explicitly. Use `--check` to inspect and `--dry-run` to preview commands.

RTK is not an npm dependency. Install the Rust Token Killer binary with Homebrew,
Cargo, or the upstream install script, then verify `rtk gain` works before
expecting compression. If `/integrations` says `rtk exists but is not Rust Token
Killer`, a different `rtk` binary is earlier on `PATH`.

TokenSave is also a native Rust CLI, not an npm dependency. OpenKaren setup uses
`brew install aovestdipaperino/tap/tokensave` or `cargo install tokensave`, then
runs `tokensave install --agent codex`, `tokensave init`, `tokensave sync`, and
`tokensave doctor --agent codex` for `OPENKAREN_AGENT_CWD`.

## Telegram E2E test

Run:

```
npm run test:routing
npm run test:e2e:telegram
npm run test:relaycron-webhook
npm run test:relayfile
```

The routing test verifies that normal messages route to development. The
Telegram E2E starts a local mock Telegram Bot API, boots OpenKaren, verifies
that OpenKaren polls `getUpdates`, receives a Telegram message, dispatches it
through the `@agent-assistant/sdk` runtime, queues the development turn when
queue mode is configured, and replies through `sendMessage`.

The test intentionally does not call the real Telegram API. A live Telegram test
needs a real bot token and chat id, and should be run manually from a private
environment.
