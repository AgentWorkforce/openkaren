# OpenKaren v1 spec 07: integrations and automation mesh

## Goal

Make external integration behavior coherent enough for v1.

OpenKaren should clearly support inbound automation events and Nango refreshes,
while being honest about what is configured vs fully wired.

## Current state

- `/webhooks/inbox` accepts n8n/Pipedream/Composio-style events.
- `/webhooks/nango` normalizes Nango connection updates.
- `src/automation-mesh.ts` routes relaycast findings to n8n webhooks.
- Relayfile watcher exists for mounted integration files.

## Desired behavior

### Inbound automation

Support and document:

- n8n webhook payloads
- Pipedream webhook payloads
- Composio webhook payloads
- Nango connection refresh payloads

All inbound events should be:

- normalized
- persisted to state when available
- surfaced to the primary user surface when appropriate
- inspectable through `/status` or recent activity answers

### Outbound automation

Automation mesh should support:

- route matching
- retries or explicit failure reporting
- clear logs
- health endpoint or dashboard section

### Relayfile

Relayfile mount state should be visible:

- path
- exists/missing
- recent events
- watched providers

## Acceptance criteria

- Inbox tests cover n8n/Pipedream/Composio payload variants.
- Nango webhook test proves DO state update through state client.
- Automation mesh test covers route miss, route hit, and failed POST.
- `/integrations` reports actionable configuration details.

## Validation

- Add focused webhook tests.
- Add docs/examples for webhook payloads.
- Manual: POST sample n8n and Nango payloads to local listener.

