Technical Design
==================

The very first development principle is that it should be accessible via Telegram
first and foremost. That will be the main development path for the lead developer: [khaliqgant](https://github.com/khaliqgant/)
to drive the product. Second is that the product will build itself, both via a human
and autonomously.

# Dependencies
The product itself’s surface area should be tight and relatively small. It is more
about putting a lot of really powerful pieces together. It should use an existing user’s
AI subscription and use the existing harness.

# First implementation slice
OpenKaren now starts as an `@agent-assistant/sdk` product. The SDK owns the
assistant runtime shell, traits, sessions, and surface registry. OpenKaren owns
the product identity, Telegram transport, local development command, and later
the product-specific prompts/tools/workflows.

The first runnable path is:

1. Telegram update arrives through long polling.
2. OpenKaren normalizes it into an agent-assistant inbound message.
3. The agent-assistant runtime dispatches the `chat` capability.
4. OpenKaren resolves the Telegram session and routes every non-command message
   as coding/development work through the configured coding-agent execution
   layer.
5. The response is sent back through the Telegram surface.

Karen's base traits are intentionally sharp: genuinely funny, sarcastic,
occasionally biting, proactive, and engineering-first. The rule is that humor is
personality, not an excuse to lower technical quality.

## List
- https://github.com/AgentWorkforce/relay - multi agent orchestration vehicle. Uses this to spawn agents to do work
- https://github.com/AgentWorkforce/agent-assistant - how we can allow a subscription and override it with some of our own logic. Light harness overlay over a claude or codex subscription
- https://github.com/AgentWorkforce/relayfile - integrations should mount as files and a user can connect their integrations using teh relayfile sdk
- https://github.com/AgentWorkforce/relaycast - main communication channel and uses webhooks to listen to incoming events. Makes the agent accessible from anywhere
- https://github.com/AgentWorkforce/relaycron - scheduled tasks handler
- https://github.com/AgentWorkforce/ricky - main drive for development work
- https://github.com/AgentWorkforce/workforce - personas to coordinate differnt types of work and customizable by the user
- https://github.com/rtk-ai/rtk - token saver mechnanism, should deeply integration
- https://github.com/jahala/tilth - token saveer mechanism, deeply integrate
- https://github.com/AgentWorkforce/burn - token usage analyst, deeply integration for analysis
- https://github.com/AgentWorkforce/wash - token saver mechanism, deeply integrate
- https://github.com/aovestdipaperino/tokensave - token saver mechanism, deeply integrate

# Dependency involvement research

Research snapshot: 2026-05-16.

## Priority 1: agent-relay

`relay` should be OpenKaren's coding-agent invocation layer. The TypeScript SDK
supports a high-level `AgentRelay` facade, local broker spawning, Codex/Claude/
Gemini/OpenCode spawners, channels, lifecycle events, idle detection, logs, and
workflow/DAG helpers. OpenKaren's first integration should not invent its own
multi-agent scheduler. Obviously. We already have enough ways to make computers
expensively confused.

First OpenKaren slice:

1. Telegram receives a development request.
2. `@agent-assistant/sdk` normalizes and dispatches the turn.
3. OpenKaren's main chat loop classifies the turn as coding work and invokes
   `@agent-relay/sdk` in relay mode.
4. Relay spawns a Codex coding agent in the OpenKaren repo with the same
   OpenKaren development prompt.
5. OpenKaren waits for idle/exit/timeout, captures bounded relay output/logs,
   sends the result back to Telegram, then shuts down the broker.

Current implementation defaults:

- `OPENKAREN_AGENT_MODE=relay`
- `OPENKAREN_AGENT_RELAY_CLI=codex`
- `OPENKAREN_AGENT_RELAY_MODEL=` optional relay model override
- `OPENKAREN_AGENT_RELAY_CHANNEL=openkaren-dev`
- `OPENKAREN_AGENT_RELAY_NAME_PREFIX=OpenKarenCoder`
- `OPENKAREN_AGENT_RELAY_IDLE_THRESHOLD_SECONDS=20`

With those defaults, multi-agent orchestration starts at the execution boundary:
each Telegram development turn is handed to `agent-relay`, which spawns a named
Codex worker in the OpenKaren repo, subscribes it to the configured relay
channel, waits for idle/exit/timeout, reads relay logs, and sends the bounded
result back through Telegram. `OPENKAREN_AGENT_MODE=command` and
`OPENKAREN_AGENT_MODE=queue` remain explicit fallback modes for machines that
are not ready to run relay yet, because realism is cheaper than pretending.

Next relay work:

- Add an explicit "plan/review/implement/verify" relay workflow instead of one
  generic worker.
- Keep the broker alive across turns once lifecycle and cleanup behavior are
  proven.
- Use relay channels/threads to stream progress summaries back to Telegram.
- Attach workforce personas to relay spawns instead of hard-coding `codex`.

## Other dependencies

| Dependency | Researched role | How OpenKaren should involve it |
| --- | --- | --- |
| `agent-assistant` | Assistant runtime primitives: identity/traits, sessions, surfaces, policy, proactive behavior, inbox, memory, coordination. | Keep it as the product shell. OpenKaren owns product behavior, Telegram transport, prompts, workflows, and routing policy above this SDK. |
| `relayfile` | File-shaped integration layer for SaaS data. Docs show GitHub/Linear/Notion/Slack-style mounts, `LAYOUT.md`, `_index.json`, and SDK read/write APIs. | Use it as the integration filesystem exposed to spawned agents. First target: mount GitHub issues/PRs and project docs read-only, then allow explicit write paths for comments/status updates. |
| `relaycast` | Headless Slack-like substrate: workspaces, agent registration, channels, threads, DMs, reactions, files, search, realtime events. | Use for backstage agent coordination and durable transcript/search. Telegram remains the first human surface; Relaycast becomes the agent team room. |
| `relaycron` | Scheduler service with one-time/cron schedules delivered by webhook POST or WebSocket, plus a local Node/SQLite server. | Use for proactive maintenance: daily repo health checks, dependency review, stale inbox sweep, scheduled roadmap planning, and "wake Karen up later" Telegram commands. |
| `ricky` | Public docs were not available during this pass. Design says it is the main drive for development work. | Treat as a placeholder until API/docs are verified. Do not wire it blindly; that is how a product gets a dependency-shaped forehead bruise. |
| `workforce` | Persona-driven orchestration: personas define prompt, model, harness, settings, skills, and tiers; `usePersona()` resolves routing metadata and `sendMessage()` can invoke harness agents. | Use after relay integration to select persona/tier for each task. Example intents: architecture plan, implementation, code review, verification, docs. |
| `rtk` | CLI output proxy for token savings on common dev commands; supports Codex setup via instructions/config and claims large reductions on noisy shell/test/git output. | Install/configure it for spawned coding agents and add OpenKaren instructions that prefer `rtk` for noisy commands. Keep raw-command fallback for debugging. |
| `tilth` | AST-aware code reading CLI/MCP. It returns outlines for large files, symbol definitions/usages, callers, structural diff, and supports Codex MCP install. | Give spawned agents a code-reading MCP/tooling path before asking them to scan the repo with raw `cat`/`rg` like it is 2017 with better branding. |
| `burn` | Release metadata points to token/session readers for Codex and OpenCode, activity classification, content sidecars, and plan-usage computation. | Use as the usage ledger and budget analyst around relay runs. First target: record per-turn cost and emit `/status` budget summaries. |
| `wash` | Public integration docs were not found during this pass. Design says token saver. | Keep as "research blocked" until source/docs clarify whether it overlaps with `rtk`, `tilth`, or `tokensave`. |
| `tokensave` | Local semantic code graph MCP with broad language/agent support, Codex install, background daemon, code-health analytics, branch indexing, and token accounting. | Evaluate against `tilth`; likely use `tokensave` for persistent graph/context and `tilth` for lightweight structural reads. Avoid installing both into every worker until the prompt/tool surface is measured. |

Integration order:

1. `relay` for Codex invocation.
2. `workforce` personas on top of relay.
3. `relayfile` + `relaycast` for integration data and team transcript.
4. `relaycron` for proactive scheduled work.
5. Token stack: start with `rtk`, then compare `tilth` and `tokensave`, then add
   `burn` for measurement. `wash` waits for usable docs.

# Inspriration to draw from
- https://github.com/openclaw/openclaw
- https://github.com/nousresearch/hermes-agent
- https://github.com/nanocoai/nanoclaw
