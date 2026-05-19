# OpenKaren v1 spec 02: first-run onboarding and command surface

## Goal

Make the first Telegram session understandable without reading source code.

The user should be able to say hello, ask what Karen can do, inspect setup, and
then send real work without accidentally launching relay for casual chat.

## Current state

- Greetings stay in the direct-answer path.
- Commands exist for `/help`, `/status`, `/integrations`, `/spend`, and `/forecast`.
- Telegram command registration exists.
- The answer-quality and routing specs introduced direct-answer behavior.

## Desired behavior

### Telegram commands

The v1 command surface should include:

- `/start`
- `/help`
- `/status`
- `/integrations`
- `/spend`
- `/forecast`
- `/dashboard`
- `/doctor`
- `/do <task>`

`/do` is the explicit escape hatch for "treat this as work" when a message is
ambiguous.

### First-run help

`/help` should answer:

- what Karen can do
- how to ask for coding work
- how to ask status/setup questions
- how to open the dashboard
- how to check token spend
- how to avoid accidental work

It should be compact enough for Telegram.

### Chat vs work policy

Casual chat and broad questions should not spawn relay. Concrete work should.

Examples that must not spawn work:

- "hey"
- "good morning Karen"
- "what can you do?"
- "what model are you using?"
- "what has changed recently?"

Examples that should spawn work:

- "fix the dashboard spend bug"
- "implement Slack thread replies"
- "review src/assistant.ts"
- "/do inspect the setup command"

## Acceptance criteria

- `/dashboard` returns the local dashboard URL.
- `/doctor` returns a compact doctor summary.
- `/do` bypasses question routing and starts the coding path.
- Greeting and direct-question E2E tests prove no relay/queue item is created.
- Coding E2E tests prove actionable work still reaches the execution layer.

## Validation

- Add/update Telegram mock tests.
- Add routing tests for `/do`.
- Keep `npm run test:spec` green.

