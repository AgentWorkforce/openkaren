# OpenKaren spec: replace phrase-patched question routing with LLM-decided routing

## Goal

Make OpenKaren answer normal user questions appropriately without relying on brittle phrase matching.

The routing policy should be:

- Keep a tiny deterministic layer only for hard command overrides like `/help`, `/status`, `/integrations`, `/spend`, `/forecast`, and `/do`.
- For normal chat messages, prefer an LLM-decided routing step that chooses whether to:
  - answer directly in chat,
  - ask a clarifying question,
  - or treat the message as a coding/development task.
- Direct-answer routing should not depend on hand-authored phrase traps like `what model`, `integrations`, or `how fully integrated` as the primary abstraction.

## Why

Current behavior is too brittle. Karen can miss obvious questions such as:

- "How fully integrated is agent assistant?"
- "How real is the agent-assistant integration?"
- "What exactly are you built on?"
- "Are you actually using relay or just pretending?"

The problem is architectural, not just missing phrases.

## Desired design

### 1. Preserve deterministic command handling

These remain explicit and non-LLM:

- `/start`
- `/help`
- `/status`
- `/integrations`
- `/spend`
- `/forecast`
- `/do <task>`

This command path should continue to bypass any LLM routing layer.

### 2. Add a lightweight LLM question router for normal chat

For all non-command chat messages:

- Build a compact local context packet first.
- Send the user message plus compact context to a small structured LLM router.
- The router decides one of:
  - `direct_answer`
  - `clarify`
  - `coding_task`

When choosing `direct_answer`, the router should also classify the answer intent into a small semantic set such as:

- `architecture`
- `integration_status`
- `runtime_status`
- `recent_activity`
- `capabilities`
- `skills_tools`
- `model_setup`
- `general`

Avoid wording-specific classes. The point is semantic routing, not phrase buckets.

### 3. Direct answers should compose from structured local truth

Direct answers should be built from a local context packet, not from canned static strings alone.

Candidate packet contents:

- active work
- recent user/assistant messages
- pending workflows
- wired integrations
- current execution mode
- relay CLI / workflow configuration
- local repo signal when available
- installed tool / capability status

The LLM can choose what kind of answer is needed, but the answer itself should be grounded in these local facts.

### 4. Clarification behavior

If the user asks something too vague, Karen should ask a helpful clarifying question instead of saying she did not get enough signal.

Bad:
- "I did not get enough signal from that one."

Better:
- "I can answer that, but I need a little more shape. Do you mean architecture, integrations, runtime status, or recent activity?"

### 5. Coding-task routing

The LLM router should only send a message to the coding path when the user is actually asking Karen to do work, for example:

- fix this bug
- inspect this file
- implement a change
- review this code
- update this behavior

A question about architecture or integration depth should not trigger coding work.

## Constraints

- Keep local development safe and cheap.
- The LLM router must be optional, behind config/env.
- If the router is not configured or fails, OpenKaren must fall back gracefully.
- Do not break `/do` or slash-command behavior.
- Do not regress relay-mode coding execution.
- Do not remove the local deterministic fallback path until the LLM path is proven.

## Configuration

Add or use config for an optional question-routing model, for example:

- `OPENKAREN_QUESTION_ROUTER_MODEL`
- existing API key env if available

If unset, Karen should continue to work with local fallback behavior.

## Implementation expectations

- Refactor the current phrase-patched direct question logic toward a semantic routing layer.
- Keep the code easy to test.
- Prefer a compact structured JSON routing response from the model.
- Keep logs readable and explicit about whether routing was decided by LLM or fallback logic.

## Validation

Add or update focused tests that prove:

1. hard commands still bypass routing
2. a normal architecture/integration question is routed to direct answer
3. a concrete work request is routed to coding
4. vague questions produce a useful clarification or general contextual answer, not the old dead-end fallback
5. fallback behavior still works when the LLM router is disabled
6. existing Telegram and relay-focused tests still pass

## Deliverable

Implement the routing refactor in this repo, run the smallest relevant tests, and leave the repo in a coherent state.
