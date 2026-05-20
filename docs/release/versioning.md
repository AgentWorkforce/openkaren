# Versioning

## Package Version Bump

1. Finish the launch checklist in `docs/release/v1-launch-checklist.md`.
2. Confirm `npm run test:spec`, `npm run build`, `karen doctor`, and `karen setup token-tools --check` have been recorded.
3. Update `package.json` from the current prerelease or development version to the v1 version.
4. Update `CHANGELOG.md` with the final v1 entry.
5. Create the git tag only after release notes and rollback instructions are ready.

## Changelog Format

Use `CHANGELOG.md` with sections:

- `Added`
- `Changed`
- `Fixed`
- `Security`
- `Operational Notes`
- `Skipped Optional Smokes`

Each release entry should link to the launch checklist evidence or quote the command results that matter.

## Release Notes Generation

Generate release notes from:

- release candidate command results,
- manual smoke script results,
- optional Slack and Cloudflare smoke status,
- rollback readiness,
- known skipped optional checks.
