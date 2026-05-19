# OpenKaren v1 spec 08: security, privacy, and operability

## Goal

Make v1 safe to run with real accounts, real tokens, and real user data.

OpenKaren touches Telegram, Slack, Nango, Cloudflare, local repo data, Burn
ledger data, and coding-agent execution. Launch readiness requires clear
boundaries and sane defaults.

## Desired behavior

### Secrets

- No secrets in logs.
- No secrets in dashboard HTML/JSON.
- No bot tokens in test snapshots.
- Redact common token shapes in error messages.

### Access control

- Telegram allowlist should be strongly recommended and visible in doctor.
- Slack channel allowlist should be supported and visible.
- State Worker bearer token should be required in production docs.
- Dashboard should default to localhost only.

### Data boundaries

Document where data lives:

- `.openkaren`
- Burn ledger
- TokenSave index
- relay state
- Cloudflare Durable Objects
- relayfile mount

### Operational controls

Add or document:

- graceful shutdown
- active turn status
- timeout behavior
- retry behavior
- dashboard disable switch
- state fallback behavior

## Acceptance criteria

- Redaction helper exists and is used in user-visible setup/doctor errors.
- `karen doctor` warns when Telegram allowlist is empty.
- Dashboard does not expose secrets.
- Docs include a data-location section.
- Production mode docs specify auth/token expectations.

## Validation

- Unit tests for redaction.
- Doctor tests for unsafe config warnings.
- Manual dashboard inspection with populated env.

