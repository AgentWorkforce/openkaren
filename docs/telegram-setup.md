# Telegram Setup Guide

## Bot Setup

1. Create a bot with BotFather.
2. Set `TELEGRAM_BOT_TOKEN`.
3. Set `TELEGRAM_ALLOWED_CHAT_IDS` to the chat ids allowed to reach this instance.
4. Start Karen with `karen start`.
5. Run `karen doctor` and resolve required failures.

## Commands

Karen registers operational commands including:

- `/status`
- `/integrations`
- `/spend`
- `/forecast`
- `/dashboard`
- `/doctor`
- `/do <task>`

## Launch Smoke

Use the manual smoke script in [release/v1-launch-checklist.md](release/v1-launch-checklist.md). The first chat message is `good morning Karen` and must not start relay work.
