# Slack Setup Guide

Slack is optional for v1 and should only be smoke-tested when Slack is in launch scope.

## Environment

- `OPENKAREN_SLACK_ENABLED=true`
- `SLACK_BOT_TOKEN` or `OPENKAREN_SLACK_BOT_TOKEN`
- `OPENKAREN_SLACK_SIGNING_SECRET`
- `OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS`
- Optional `OPENKAREN_SLACK_WEBHOOK_PATH`, defaulting to the local Slack webhook route.

## Setup

1. Create a Slack app with event subscriptions.
2. Configure the local or tunnelled webhook URL.
3. Restrict allowed channels with `OPENKAREN_SLACK_ALLOWED_CHANNEL_IDS`.
4. Start Karen and run `karen doctor`.
5. Send a signed Slack event and confirm the reply stays in the thread.

## Release Gate

The Slack webhook smoke is optional and conditional on Slack being part of the launch scope. Record skipped status in the release notes when Slack is out of scope.
