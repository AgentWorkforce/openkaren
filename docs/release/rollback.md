# Rollback Instructions

## When To Roll Back

Roll back when v1 launch smoke shows broken command routing, unsafe secret exposure, non-local dashboard binding, incorrect Burn scope, or failed required release candidate commands.

## Package Rollback

1. Stop the running Karen process.
2. Reinstall the previous known-good package version.
3. Restore the previous environment file.
4. Start Karen.
5. Run `karen doctor`.
6. Run the manual smoke script from `docs/release/v1-launch-checklist.md` against the previous version.

## State Rollback

- Local state: preserve `.openkaren` before deleting or replacing it.
- Cloudflare state: avoid destructive Durable Object changes unless a separate state migration rollback exists.
- Relay state: stop active relay sessions before replacing code or configuration.

## Communication

Record:

- failed v1 version,
- rollback target version,
- failed gate or smoke step,
- operator,
- timestamp,
- whether optional Slack or Cloudflare smokes were in scope.
