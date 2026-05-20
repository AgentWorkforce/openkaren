# Installation Guide

## Requirements

- Node.js 22 or newer.
- npm.
- A Telegram bot token for the Telegram surface.
- Optional local tools: Agent Relay, Relayfile, Relaycron, Relaycast, Nango, Burn, rtk, Tilth, wash, and TokenSave.

## Install

```sh
npm install -g openkaren
```

For a local checkout:

```sh
npm install
npm run build
node dist/cli.js start
```

## First Run

1. Create an environment file with at least `TELEGRAM_BOT_TOKEN`.
2. Set `TELEGRAM_ALLOWED_CHAT_IDS` before production use.
3. Start Karen with `karen start`.
4. Run `karen doctor`.
5. Run `karen setup token-tools --check`.

## Release Readiness

Before tagging v1, run the launch gate in [release/v1-launch-checklist.md](release/v1-launch-checklist.md).
